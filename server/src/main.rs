use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    u32,
};
use tower_http::services::ServeDir;

mod db;
use db::*;

const MB: u32 = 1024 * 1024;

#[derive(Debug, Serialize, Clone, Copy)]
pub struct PublicConfig {
    /// Maximum final size of a note (after encryption and packaging)
    pub max_note_size: u32,
    /// Maximum number of files, 0 means no file allowed
    pub max_files: u32,
    /// Number of seconds before this note is removed, 0 for never
    pub default_expires_after: u32,
    /// Number of views before this note is removed, 0 for never
    pub default_remaining_views: u32,
}

struct AppState {
    config: PublicConfig,
    db: Mutex<Database>,
}

#[tokio::main]
async fn main() {
    let max_note_size_in_mb = 1000;
    let max_memory_usage = 2000 * (MB as usize);

    let config = PublicConfig {
        max_note_size: max_note_size_in_mb * MB,
        max_files: u32::MAX,
        default_expires_after: 0,
        default_remaining_views: 1,
    };
    let db = Mutex::new(Database::new(max_memory_usage));
    let appstate = Arc::new(AppState { config, db });

    let static_files = ServeDir::new("D:/Dev/Perso/rsecnotes/public");
    let app = Router::new()
        .fallback_service(static_files)
        .route("/config", get(handler_config))
        .route("/notes", post(handler_add_note))
        .route("/notes/{note_id}", get(handler_read_note))
        .layer(DefaultBodyLimit::max(max_memory_usage))
        .with_state(appstate);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("Listening on http://{}", listener.local_addr().unwrap());
    println!("max_note_size = {} MB", max_note_size_in_mb);
    println!("max_memory_usage = {} MB", max_memory_usage / (MB as usize));
    axum::serve(listener, app).await.unwrap();
}

const X_EXPIRES_AFTER: &'static str = "x-note-expires-after";
const X_REMAINING_VIEWS: &'static str = "x-note-remaining-views";

fn into_bad_request(e: impl ToString) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, e.to_string())
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
    let expires_after = header_to_u32(headers.get(X_EXPIRES_AFTER))?;
    let remaining_views = header_to_u32(headers.get(X_REMAINING_VIEWS))?;
    let content = NoteContent {
        data,
        expires_after,
        remaining_views,
    };
    let note_id = db.add_note(content).map_err(into_bad_request)?;
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
