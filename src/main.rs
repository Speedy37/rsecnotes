use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use bytesize::ByteSize;
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

mod db;
use db::*;

/// A secure sharing note and or file(s) service.
#[derive(Parser, Debug)]
struct Args {
    /// Listen port
    #[arg(long, default_value_t = 3000)]
    pub port: u32,

    /// Maximum memory usage in bytes
    #[arg(long, default_value = "1GiB")]
    pub max_memory_usage: ByteSize,

    #[command(flatten)]
    pub public: PublicConfig,
}

#[derive(Parser, Debug, Serialize, Deserialize, Clone, Copy)]
pub struct PublicConfig {
    /// Maximum final size of a note in bytes (after encryption and packaging)
    #[arg(long, default_value = "32MiB")]
    pub max_note_size: ByteSize,

    /// Maximum number of files, 0 means no file allowed
    #[arg(long, default_value_t = u32::MAX)]
    pub max_files: u32,

    /// Number of seconds before this note is removed, 0 for never
    #[arg(long, default_value_t = 0)]
    pub default_expires_after: u32,

    /// Number of views before this note is removed, 0 for never
    #[arg(long, default_value_t = 1)]
    pub default_remaining_views: u32,

    /// Minimal number of views before this note is removed
    #[arg(long, default_value_t = 0)]
    pub min_remaining_views: u32,

    /// Maximal number of views before this note is removed, 0 for no limits
    #[arg(long, default_value_t = 0)]
    pub max_remaining_views: u32,

    /// Minimal number of seconds before this note is removed
    #[arg(long, default_value_t = 0)]
    pub min_expires_after: u32,

    /// Maximal number of seconds before this note is removed, 0 for no limits
    #[arg(long, default_value_t = 3600*24)]
    pub max_expires_after: u32,
}

struct AppState {
    config: PublicConfig,
    db: Mutex<Database>,
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

    let max_memory_usage = args.max_memory_usage.as_u64() as usize;
    let db = Mutex::new(Database::new(max_memory_usage));
    let appstate = Arc::new(AppState {
        config: args.public,
        db,
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
        .layer(DefaultBodyLimit::max(max_memory_usage))
        .with_state(appstate);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    println!("Listening on http://{}", listener.local_addr()?);
    println!("{:#?}", &args);
    axum::serve(listener, app).await?;
    Ok(())
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
    Json(appstate.config)
}

async fn handler_add_note(
    State(appstate): State<Arc<AppState>>,
    headers: HeaderMap,
    data: Bytes,
) -> Result<impl IntoResponse, (StatusCode, String)> {
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

    let mut db = appstate.db.lock().unwrap();

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
    let note_memory_usage = ByteSize(content.note_memory_usage() as u64);
    let note_id = db.add_note(content).map_err(into_bad_request)?;
    let db_memory_usage = ByteSize(db.memory_usage() as u64);
    println!("new  note {}, sum = {}", note_memory_usage, db_memory_usage);
    Ok(note_id.to_string())
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
    let mut db = appstate.db.lock().unwrap();
    let note_id: NoteId = note_id.parse().map_err(into_bad_request)?;
    match db.read_note(note_id) {
        Some(content) => {
            let note_memory_usage = ByteSize(content.note_memory_usage() as u64);
            let db_memory_usage = ByteSize(db.memory_usage() as u64);
            println!(
                "read note {}, sum = {} {}",
                note_memory_usage,
                db_memory_usage,
                if content.expired() { "(expired)" } else { "" }
            );
            Ok((
                [
                    ("content-type", "application/octet-stream".to_string()),
                    (X_EXPIRES_AFTER, header_value(content.expires_after)),
                    (X_REMAINING_VIEWS, header_value(content.remaining_views)),
                ],
                content.data,
            ))
        }
        None => Err((StatusCode::NOT_FOUND, "note_id not found".to_string())),
    }
}
