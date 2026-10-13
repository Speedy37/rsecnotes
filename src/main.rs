use axum::{
    Json, Router,
    body::Bytes,
    extract::{ConnectInfo, DefaultBodyLimit, Path, State},
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
    sync::{Arc, Mutex},
    time::Instant,
};

mod db;
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ConfigFileSlot {
    /// Maximum final size of a note in bytes (after encryption and packaging)
    pub max_note_size: Size,
    /// Maximum memory usage in bytes of this slot
    pub max_memory_usage: Size,
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
}

struct AppState {
    config: PublicConfig,
    db: Mutex<Database>,
    rate_limiter: Option<Mutex<RateLimiter>>,
    client_ip_header: Option<HeaderName>,
}

trait StaticFile {
    const ROUTE: &'static str;
    const CONTENT_TYPE: &'static [u8];
    const CONTENT: &'static [u8];
}
macro_rules! static_file {
    ($name:ident, $content_type:expr, $route:expr) => {
        struct $name;
        impl StaticFile for $name {
            const ROUTE: &'static str = $route;
            const CONTENT_TYPE: &'static [u8] = $content_type;
            const CONTENT: &'static [u8] = include_bytes!(concat!("../public", $route));
        }
    };
}
static_file!(IndexHtml, b"text/html", "/index.html");
static_file!(IndexCss, b"text/css", "/index.css");
static_file!(IndexJs, b"text/javascript", "/index.js");
static_file!(IconSvg, b"image/svg+xml", "/icon.svg");

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
    let db = Database::new(&config.server_settings.slots);
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
    let appstate = Arc::new(AppState {
        config: PublicConfig {
            max_note_size: max_note_size.bytes,
            max_files: config.client_settings.max_files,
            default_expires_after: config.client_settings.default_expires_after.seconds,
            default_remaining_views: config.client_settings.default_remaining_views,
            min_remaining_views: config.server_settings.min_remaining_views,
            max_remaining_views: config.server_settings.max_remaining_views,
            min_expires_after: config.server_settings.min_expires_after.seconds,
            max_expires_after: config.server_settings.max_expires_after.seconds,
        },
        db: Mutex::new(db),
        rate_limiter,
        client_ip_header,
    });

    let app = Router::new()
        .route("/", get(handler_static::<IndexHtml>))
        .route(IndexHtml::ROUTE, get(handler_static::<IndexHtml>))
        .route(IndexCss::ROUTE, get(handler_static::<IndexCss>))
        .route(IndexJs::ROUTE, get(handler_static::<IndexJs>))
        .route(IconSvg::ROUTE, get(handler_static::<IconSvg>))
        .route("/config", get(handler_config))
        .route("/notes", post(handler_add_note))
        .route("/notes/{note_id}", get(handler_read_note))
        .layer(DefaultBodyLimit::max(max_note_size.bytes))
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

async fn handler_static<S: StaticFile>() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, S::CONTENT_TYPE)], S::CONTENT)
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
    data: Bytes,
) -> Response {
    if let Some(rate_limiter) = &appstate.rate_limiter {
        let ip = client_ip(&appstate, peer, &headers);
        let acquired = rate_limiter
            .lock()
            .unwrap()
            .try_acquire(ip, data.len(), Instant::now());
        if let Err(retry_after) = acquired {
            let retry_after = retry_after.as_secs_f64().ceil().to_string();
            return (
                StatusCode::TOO_MANY_REQUESTS,
                [(header::RETRY_AFTER, retry_after)],
                "too many notes created, retry later",
            )
                .into_response();
        }
    }
    add_note(&appstate, &headers, data).into_response()
}

fn add_note(
    appstate: &AppState,
    headers: &HeaderMap,
    data: Bytes,
) -> Result<String, (StatusCode, String)> {
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

    let mut db_guarded = appstate.db.lock().unwrap();

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

    let content = NoteContent {
        data,
        expires_after,
        remaining_views,
    };
    let note_id = db_guarded.add_note(content).map_err(into_bad_request)?;
    Ok(note_id.as_string())
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
    let mut db_guarded = appstate.db.lock().unwrap();
    let note_id: NoteId = note_id.parse().map_err(into_bad_request)?;
    match db_guarded.read_note(note_id) {
        Some(content) => Ok((
            [
                ("content-type", "application/octet-stream".to_string()),
                (X_EXPIRES_AFTER, header_value(content.expires_after)),
                (X_REMAINING_VIEWS, header_value(content.remaining_views)),
            ],
            content.data,
        )),
        None => Err((StatusCode::NOT_FOUND, "note_id not found".to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn example_config_content() {
        let _config: ConfigFile = toml::from_slice(&EXAMPLE_CONFIG).unwrap();
    }
}
