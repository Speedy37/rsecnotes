use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, HeaderName, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self},
    io::Write,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Instant,
};

mod db;
mod filestore;
mod ratelimit;
mod util;
use db::*;
use ratelimit::RateLimiter;

use crate::util::{Duration, Size};

/// A secure sharing note and or file(s) service.
#[derive(Parser, Debug)]
enum Args {
    /// Generate a default configuration file
    GenerateConfig {
        /// Path to the config file
        #[arg(short, long)]
        config: String,
        /// Overwrite if config file already exists
        #[arg(short, long)]
        force: bool,
    },
    /// Run the server
    Run {
        /// Path to the config file
        #[arg(short, long)]
        config: String,
    },
}

const EXAMPLE_CONFIG: &[u8] = include_bytes!("./config.example.toml");

#[derive(Default, Debug, Serialize, Deserialize, Clone)]
struct ConfigFile {
    pub server_settings: ConfigFileServer,
    pub client_settings: ConfigFileClient,
}

#[derive(Default, Debug, Serialize, Deserialize, Clone)]
struct ConfigFileServer {
    /// Listen address
    #[serde(default)]
    pub host: String,

    /// Listen port
    pub port: u16,

    /// Notes are put into the slot with the lowest `max_note_size` that let it fit
    /// This allow for big notes to not force small notes reclamation for memory.
    /// Reclamation for memory inside a slot is always done from oldest to newest.
    pub slots: Vec<ConfigFileSlot>,

    /// Minimal number of views before this note is removed
    pub min_remaining_views: u32,

    /// Maximal number of views before this note is removed, 0 for no limits
    pub max_remaining_views: u32,

    /// Minimal number of seconds before this note is removed
    pub min_expires_after: Duration,

    /// Maximal number of seconds before this note is removed, 0 for no limits
    pub max_expires_after: Duration,

    /// Per client limits on notes creation, no limits if absent
    pub rate_limit: Option<ConfigFileRateLimit>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ConfigFileRateLimit {
    /// Duration over which a client budget is fully refilled
    pub period: Duration,

    /// Maximum number of notes a client can create over `period`
    pub max_notes: u32,

    /// Maximum total size of notes a client can create over `period`
    pub max_size: Size,

    /// Header containing the client IP when behind a reverse proxy (eg. "x-forwarded-for"),
    /// its last value is used. If absent, the connection peer address is used.
    pub client_ip_header: Option<String>,
}

#[derive(Default, Debug, Serialize, Deserialize, Clone)]
struct ConfigFileClient {
    /// Maximum number of files, 0 means no file allowed
    pub max_files: u32,

    /// Number of seconds before this note is removed, 0 for never
    pub default_expires_after: Duration,

    /// Number of views before this note is removed, 0 for never
    pub default_remaining_views: u32,

    /// Image (svg, png, jpg, webp or gif) shown at the right of the title, none if absent
    pub logo: Option<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ConfigFileSlot {
    /// Maximum final size of a note in bytes (after encryption and packaging)
    pub max_note_size: Size,
    /// Maximum memory usage in bytes of this slot (disk usage if `directory` is set)
    pub max_memory_usage: Size,
    /// Store notes of this slot in this directory instead of memory,
    /// encrypted with a key generated at startup. Notes from a previous run are removed.
    pub directory: Option<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PublicConfig {
    /// Maximum final size of a note in bytes (after encryption and packaging), server enforced
    pub max_note_size: usize,

    /// Maximum number of files, 0 means no file allowed
    pub max_files: u32,

    /// Number of seconds before this note is removed, 0 for never
    pub default_expires_after: u32,

    /// Number of views before this note is removed, 0 for never
    pub default_remaining_views: u32,

    /// Minimal number of views before this note is remove, server enforced
    pub min_remaining_views: u32,

    /// Maximal number of views before this note is removed, 0 for no limits, server enforced
    pub max_remaining_views: u32,

    /// Minimal number of seconds before this note is removed, server enforced
    pub min_expires_after: u32,

    /// Maximal number of seconds before this note is removed, 0 for no limits, server enforced
    pub max_expires_after: u32,

    /// A logo is served at /logo
    pub logo: bool,
}

struct Logo {
    content_type: &'static str,
    content: Bytes,
}

impl Logo {
    fn load(path: &std::path::Path) -> anyhow::Result<Self> {
        let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or_default();
        let content_type = match ext.to_ascii_lowercase().as_str() {
            "svg" => "image/svg+xml",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "gif" => "image/gif",
            _ => anyhow::bail!("logo: {path:?} must be a svg, png, jpg, webp or gif image"),
        };
        let content = fs::read(path).map_err(|err| anyhow::anyhow!("logo: {path:?}: {err}"))?;
        Ok(Self { content_type, content: content.into() })
    }
}

struct AppState {
    config: PublicConfig,
    logo: Option<Logo>,
    db: Mutex<Database>,
    rate_limiter: Option<Mutex<RateLimiter>>,
    client_ip_header: Option<HeaderName>,
}

/// The whole client, with index.css, index.js and icon.svg inlined by build.rs
const INDEX_HTML: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/index.html"));

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    match args {
        Args::GenerateConfig { config, force } => {
            let mut options = fs::OpenOptions::new();
            options.write(true);
            if force {
                options.create(true);
                options.truncate(true);
            } else {
                options.create_new(true);
            }
            let mut file = options.open(config)?;
            file.write_all(EXAMPLE_CONFIG)?;
            Ok(())
        }
        Args::Run { config } => {
            let config: Vec<u8> = fs::read(config)?;
            let config: ConfigFile = toml::from_slice(&config)?;
            main_run(&config).await
        }
    }
}

async fn main_run(config: &ConfigFile) -> anyhow::Result<()> {
    let db = Database::new(&config.server_settings.slots)?;
    let max_note_size = db.max_note_size();
    let (rate_limiter, client_ip_header) = match &config.server_settings.rate_limit {
        Some(rate_limit) => {
            anyhow::ensure!(
                rate_limit.max_notes > 0 && rate_limit.period.seconds > 0,
                "rate_limit: max_notes and period must be non zero"
            );
            anyhow::ensure!(
                rate_limit.max_size >= max_note_size,
                "rate_limit: max_size must be at least the biggest slot max_note_size ({max_note_size})"
            );
            let client_ip_header = match &rate_limit.client_ip_header {
                Some(name) => Some(HeaderName::try_from(name.as_str())?),
                None => None,
            };
            let rate_limiter = RateLimiter::new(
                rate_limit.max_notes,
                rate_limit.max_size.bytes,
                std::time::Duration::from_secs(rate_limit.period.seconds.into()),
            );
            (Some(Mutex::new(rate_limiter)), client_ip_header)
        }
        None => (None, None),
    };
    let logo = match &config.client_settings.logo {
        Some(path) => Some(Logo::load(path)?),
        None => None,
    };
    let appstate = Arc::new(AppState {
        config: PublicConfig {
            logo: logo.is_some(),
            max_note_size: max_note_size.bytes,
            max_files: config.client_settings.max_files,
            default_expires_after: config.client_settings.default_expires_after.seconds,
            default_remaining_views: config.client_settings.default_remaining_views,
            min_remaining_views: config.server_settings.min_remaining_views,
            max_remaining_views: config.server_settings.max_remaining_views,
            min_expires_after: config.server_settings.min_expires_after.seconds,
            max_expires_after: config.server_settings.max_expires_after.seconds,
        },
        logo,
        db: Mutex::new(db),
        rate_limiter,
        client_ip_header,
    });

    let app = Router::new()
        .route("/", get(handler_index))
        .route("/index.html", get(handler_index))
        .route("/logo", get(handler_logo))
        .route("/config", get(handler_config))
        .route("/notes", post(handler_add_note))
        .route("/notes/{note_id}", get(handler_read_note))
        .layer(axum::middleware::map_response(set_security_headers))
        .with_state(appstate.clone());

    let listener = tokio::net::TcpListener::bind((
        config.server_settings.host.as_str(),
        config.server_settings.port,
    ))
    .await?;
    println!("Listening on http://{}", listener.local_addr()?);
    println!("{:#?}", config);
    tokio::try_join!(
        collect_expired_notes(appstate),
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>()
        )
    )?;
    Ok(())
}

async fn collect_expired_notes(appstate: Arc<AppState>) -> std::io::Result<()> {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));

    loop {
        interval.tick().await;

        let now = Instant::now();
        appstate.db.lock().unwrap().collect_expired_notes(now);
        if let Some(rate_limiter) = &appstate.rate_limiter {
            rate_limiter.lock().unwrap().collect_full_buckets(now);
        }
    }
}

const X_EXPIRES_AFTER: &str = "x-note-expires-after";
const X_REMAINING_VIEWS: &str = "x-note-remaining-views";

fn into_bad_request(e: impl ToString) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, e.to_string())
}

/// Only the index.html inlined script and style (by hash, see build.rs), same origin resources,
/// plus data URIs for the embedded font, icon and QR code image
const CONTENT_SECURITY_POLICY: header::HeaderValue = header::HeaderValue::from_static(concat!(
    "default-src 'none'; script-src ",
    env!("CSP_SCRIPT_HASH"),
    "; style-src ",
    env!("CSP_STYLE_HASH"),
    "; img-src 'self' data:; font-src data:; \
     connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
));

async fn set_security_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY);
    // The page URL holds the note decryption key
    headers.insert(header::REFERRER_POLICY, header::HeaderValue::from_static("no-referrer"));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, header::HeaderValue::from_static("nosniff"));
    response
}

async fn handler_index() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/html")], INDEX_HTML)
}

async fn handler_logo(State(appstate): State<Arc<AppState>>) -> Response {
    match &appstate.logo {
        Some(logo) => ([(header::CONTENT_TYPE, logo.content_type)], logo.content.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn handler_config(State(appstate): State<Arc<AppState>>) -> Json<PublicConfig> {
    Json(appstate.config.clone())
}

/// Client IP from `client_ip_header` (last value) if configured and valid, else the peer address
fn client_ip(appstate: &AppState, peer: SocketAddr, headers: &HeaderMap) -> IpAddr {
    appstate
        .client_ip_header
        .as_ref()
        .and_then(|name| headers.get_all(name).iter().next_back())
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit(',').next())
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(peer.ip())
}

async fn handler_add_note(
    State(appstate): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    match add_note(&appstate, peer, &headers, body).await {
        Ok(note_id) => note_id.into_response(),
        Err(err) => err,
    }
}

fn into_internal_error(e: impl std::fmt::Display) -> (StatusCode, String) {
    eprintln!("internal error: {e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string())
}

/// Note length from the required content-length header, the body must match it exactly
fn declared_len(appstate: &AppState, headers: &HeaderMap) -> Result<usize, (StatusCode, String)> {
    let len: usize = headers
        .get(header::CONTENT_LENGTH)
        .ok_or((
            StatusCode::LENGTH_REQUIRED,
            "content-length required".to_string(),
        ))?
        .to_str()
        .map_err(into_bad_request)?
        .parse()
        .map_err(into_bad_request)?;
    if len > appstate.config.max_note_size {
        return Err((StatusCode::PAYLOAD_TOO_LARGE, "note too big".to_string()));
    }
    Ok(len)
}

/// Note `(expires_after, remaining_views)` from headers, clamped to the server limits
fn note_settings(appstate: &AppState, headers: &HeaderMap) -> Result<(u32, u32), (StatusCode, String)> {
    fn header_to_u32(h: Option<&header::HeaderValue>) -> Result<u32, (StatusCode, String)> {
        Ok(match h {
            Some(v) => v
                .to_str()
                .map_err(into_bad_request)?
                .parse()
                .map_err(into_bad_request)?,
            None => 0u32,
        })
    }

    let mut expires_after = header_to_u32(headers.get(X_EXPIRES_AFTER))?;
    expires_after = expires_after.max(appstate.config.min_expires_after);
    if appstate.config.max_expires_after > 0 {
        expires_after = expires_after.min(appstate.config.max_expires_after);
    }

    let mut remaining_views = header_to_u32(headers.get(X_REMAINING_VIEWS))?;
    remaining_views = remaining_views.max(appstate.config.min_remaining_views);
    if appstate.config.max_remaining_views > 0 {
        remaining_views = remaining_views.min(appstate.config.max_remaining_views);
    }
    Ok((expires_after, remaining_views))
}

/// Everything is checked before receiving the body
async fn add_note(
    appstate: &AppState,
    peer: SocketAddr,
    headers: &HeaderMap,
    body: Body,
) -> Result<String, Response> {
    let len = declared_len(appstate, headers).map_err(IntoResponse::into_response)?;
    let (expires_after, remaining_views) =
        note_settings(appstate, headers).map_err(IntoResponse::into_response)?;
    if let Some(rate_limiter) = &appstate.rate_limiter {
        let ip = client_ip(appstate, peer, headers);
        let acquired = rate_limiter
            .lock()
            .unwrap()
            .try_acquire(ip, len, Instant::now());
        if let Err(retry_after) = acquired {
            let retry_after = retry_after.as_secs_f64().ceil().to_string();
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                [(header::RETRY_AFTER, retry_after)],
                "too many notes created, retry later",
            )
                .into_response());
        }
    }
    let data = receive_note_data(appstate, len, body)
        .await
        .map_err(IntoResponse::into_response)?;
    let content = NoteContent {
        data,
        expires_after,
        remaining_views,
    };
    let note_id = appstate
        .db
        .lock()
        .unwrap()
        .add_note(content)
        .map_err(|err| into_bad_request(err).into_response())?;
    Ok(note_id.as_string())
}

/// Receive the `len` bytes body in memory, or stream it encrypted to a file if its slot is
/// file backed, outside of the database lock
async fn receive_note_data(
    appstate: &AppState,
    len: usize,
    body: Body,
) -> Result<NoteData, (StatusCode, String)> {
    let file_store = appstate
        .db
        .lock()
        .unwrap()
        .file_store(len)
        .map_err(into_bad_request)?;
    match file_store {
        Some(file_store) => {
            let file = file_store
                .write(len, body.into_data_stream())
                .await
                .map_err(|err| match err.kind() {
                    std::io::ErrorKind::InvalidInput | std::io::ErrorKind::ConnectionAborted => {
                        into_bad_request(err)
                    }
                    _ => into_internal_error(err),
                })?;
            Ok(NoteData::File(Arc::new(file)))
        }
        None => {
            let data = axum::body::to_bytes(body, len)
                .await
                .map_err(into_bad_request)?;
            if data.len() != len {
                return Err(into_bad_request("note is shorter than declared"));
            }
            Ok(NoteData::Memory(data))
        }
    }
}

async fn handler_read_note(
    State(appstate): State<Arc<AppState>>,
    Path(note_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    fn header_value(v: Option<u32>) -> String {
        match v {
            Some(v) => v.to_string(),
            None => "-1".to_string(),
        }
    }
    let note_id: NoteId = note_id.parse().map_err(into_bad_request)?;
    let content = appstate
        .db
        .lock()
        .unwrap()
        .read_note(note_id)
        .ok_or((StatusCode::NOT_FOUND, "note_id not found".to_string()))?;
    let len = content.data.len();
    let body = match content.data {
        NoteData::Memory(data) => Body::from(data),
        // the file is kept until fully read, even if the note is removed meanwhile
        NoteData::File(file) => Body::from_stream(file.read().await.map_err(into_internal_error)?),
    };
    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (header::CONTENT_LENGTH, len.to_string()),
            // A cached copy would outlive the note views limit and expiration
            (header::CACHE_CONTROL, "no-store".to_string()),
            (HeaderName::from_static(X_EXPIRES_AFTER), header_value(content.expires_after)),
            (HeaderName::from_static(X_REMAINING_VIEWS), header_value(content.remaining_views)),
        ],
        body,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn example_config_content() {
        let _config: ConfigFile = toml::from_slice(&EXAMPLE_CONFIG).unwrap();
    }
}
