use axum::{
    Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use tower_http::services::ServeDir;
use std::sync::{Arc, Mutex};

mod db;
use db::*;

const MB: usize = 1024 * 1024;

#[tokio::main]
async fn main() {
    let max_note_size_in_mb = 1000;
    let max_memory_usage_in_mb = 2000;
    let mut db = Database::default();
    db.max_note_size = max_note_size_in_mb * MB;
    db.max_memory_usage = max_memory_usage_in_mb * MB;
    let db = Arc::new(Mutex::new(db));

    let static_files = ServeDir::new("D:/Dev/Perso/rsecnotes/public");
    let app = Router::new()
        .fallback_service(static_files)
        .route("/config", post(add_note))
        .route("/notes", post(add_note))
        .route("/notes/{note_id}", get(read_note))
        .layer(DefaultBodyLimit::max(max_note_size_in_mb * MB))
        .with_state(db);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("Listening on http://{}", listener.local_addr().unwrap());
    println!("max_note_size = {} MB", max_note_size_in_mb);
    println!("max_memory_usage = {} MB", max_memory_usage_in_mb);
    axum::serve(listener, app).await.unwrap();
}

const X_EXPIRES_AFTER: &'static str = "x-note-expires-after";
const X_REMAINING_VIEWS: &'static str = "x-note-remaining-views";

fn into_bad_request(e: impl ToString) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, e.to_string())
}

async fn add_note(
    State(db): State<Arc<Mutex<Database>>>,
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

    let mut db = db.lock().unwrap();
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

async fn read_note(
    State(db): State<Arc<Mutex<Database>>>,
    Path(note_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    fn header_value(v: Option<u32>) -> String {
        match v {
            Some(v) => v.to_string(),
            None => "-1".to_string(),
        }
    }
    let mut db = db.lock().unwrap();
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
