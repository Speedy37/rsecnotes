use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Bytes;
use chacha20poly1305::aead::KeyInit;
use chacha20poly1305::aead::generic_array::GenericArray;
use chacha20poly1305::aead::stream::{DecryptorBE32, EncryptorBE32};
use chacha20poly1305::{Key, XChaCha20Poly1305};
use futures_util::{Stream, StreamExt};
use rand::Rng;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const EXTENSION: &str = "note";
/// STREAM nonce prefix: XChaCha20 24 bytes nonce - 4 bytes counter - 1 byte last flag
const NONCE_PREFIX_LEN: usize = 19;
const TAG_LEN: usize = 16;
/// Plaintext chunk size, only the last chunk can be smaller (or empty)
const CHUNK_LEN: usize = 64 * 1024;

/// Directory of notes encrypted with a key generated at startup and only kept in memory,
/// so notes are unreadable once the process is gone.
///
/// Notes are encrypted by chunks with the STREAM construction (each chunk is authenticated
/// with its position and whether it is the last one), file layout: nonce prefix || chunks,
/// so notes are streamed to and from disk without being fully loaded in memory.
pub struct FileStore {
    directory: PathBuf,
    cipher: XChaCha20Poly1305,
}

impl std::fmt::Debug for FileStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileStore")
            .field("directory", &self.directory)
            .finish_non_exhaustive()
    }
}

/// Encrypted note file, removed from disk when dropped
#[derive(Debug)]
pub struct NoteFile {
    store: Arc<FileStore>,
    path: PathBuf,
    /// Plaintext length
    len: usize,
}

impl Drop for NoteFile {
    fn drop(&mut self) {
        if let Err(err) = fs::remove_file(&self.path) {
            eprintln!("failed to remove {}: {err}", self.path.display());
        }
    }
}

fn crypto_error(_: chacha20poly1305::aead::Error) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "note encryption/decryption failed",
    )
}

/// Body length doesn't match the declared length (client error)
fn length_error(msg: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, msg)
}

/// Failed to receive the body (client error)
fn body_error(err: impl Into<Box<dyn std::error::Error + Send + Sync>>) -> io::Error {
    io::Error::new(io::ErrorKind::ConnectionAborted, err)
}

/// Fill `buffer` up to `chunk_len` bytes from `pending` then `body`
async fn fill_chunk<S, E>(
    body: &mut S,
    pending: &mut Bytes,
    buffer: &mut Vec<u8>,
    chunk_len: usize,
) -> io::Result<()>
where
    S: Stream<Item = Result<Bytes, E>> + Unpin,
    E: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    while buffer.len() < chunk_len {
        if pending.is_empty() {
            *pending = match body.next().await {
                Some(frame) => frame.map_err(body_error)?,
                None => return Err(length_error("note is shorter than declared")),
            };
            continue;
        }
        let take = (chunk_len - buffer.len()).min(pending.len());
        buffer.extend_from_slice(&pending.split_to(take));
    }
    Ok(())
}

impl FileStore {
    /// Create `directory` if needed and remove notes left by a previous run (their key is lost)
    pub fn new(directory: &Path) -> io::Result<Arc<Self>> {
        fs::create_dir_all(directory)?;
        for entry in fs::read_dir(directory)? {
            let path = entry?.path();
            if path.extension().is_some_and(|ext| ext == EXTENSION) && path.is_file() {
                fs::remove_file(&path)?;
            }
        }
        let key: [u8; 32] = rand::rng().random();
        Ok(Arc::new(Self {
            directory: directory.to_path_buf(),
            cipher: XChaCha20Poly1305::new(Key::from_slice(&key)),
        }))
    }

    /// Encrypt to a new file a note of exactly `len` bytes streamed from `body`
    pub async fn write<S, E>(self: &Arc<Self>, len: usize, body: S) -> io::Result<NoteFile>
    where
        S: Stream<Item = Result<Bytes, E>> + Unpin,
        E: Into<Box<dyn std::error::Error + Send + Sync>>,
    {
        // random name, unrelated to the note id
        let name: [u8; 16] = rand::rng().random();
        let name: String = name.iter().map(|b| format!("{b:02x}")).collect();
        let path = self.directory.join(format!("{name}.{EXTENSION}"));
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await?;
        // from now on the file is removed on error
        let note_file = NoteFile {
            store: self.clone(),
            path,
            len,
        };
        // `file` is closed before `note_file` is dropped
        self.write_chunks(file, note_file.aad(), len, body).await?;
        Ok(note_file)
    }

    async fn write_chunks<S, E>(
        &self,
        mut file: tokio::fs::File,
        aad: &[u8],
        len: usize,
        mut body: S,
    ) -> io::Result<()>
    where
        S: Stream<Item = Result<Bytes, E>> + Unpin,
        E: Into<Box<dyn std::error::Error + Send + Sync>>,
    {
        let nonce_prefix: [u8; NONCE_PREFIX_LEN] = rand::rng().random();
        file.write_all(&nonce_prefix).await?;
        let mut encryptor =
            EncryptorBE32::from_aead(self.cipher.clone(), GenericArray::from_slice(&nonce_prefix));

        let mut pending = Bytes::new();
        let mut buffer = Vec::with_capacity(CHUNK_LEN + TAG_LEN);
        let mut remaining = len;
        while remaining > CHUNK_LEN {
            fill_chunk(&mut body, &mut pending, &mut buffer, CHUNK_LEN).await?;
            encryptor
                .encrypt_next_in_place(aad, &mut buffer)
                .map_err(crypto_error)?;
            file.write_all(&buffer).await?;
            buffer.clear();
            remaining -= CHUNK_LEN;
        }
        fill_chunk(&mut body, &mut pending, &mut buffer, remaining).await?;
        encryptor
            .encrypt_last_in_place(aad, &mut buffer)
            .map_err(crypto_error)?;
        file.write_all(&buffer).await?;
        file.flush().await?;

        if !pending.is_empty() {
            return Err(length_error("note is longer than declared"));
        }
        while let Some(frame) = body.next().await {
            if !frame.map_err(body_error)?.is_empty() {
                return Err(length_error("note is longer than declared"));
            }
        }
        Ok(())
    }
}

impl NoteFile {
    /// Plaintext length
    pub fn len(&self) -> usize {
        self.len
    }

    fn file_len(&self) -> u64 {
        let chunks = self.len.div_ceil(CHUNK_LEN).max(1);
        (NONCE_PREFIX_LEN + self.len + chunks * TAG_LEN) as u64
    }

    /// Bind the ciphertext to its file name
    fn aad(&self) -> &[u8] {
        self.path.file_name().unwrap_or_default().as_encoded_bytes()
    }

    /// Stream the decrypted note, the file is kept until the stream is dropped.
    /// A corrupted chunk ends the stream with an error.
    pub async fn read(
        self: Arc<Self>,
    ) -> io::Result<impl Stream<Item = io::Result<Bytes>> + Send + 'static> {
        let mut file = tokio::fs::File::open(&self.path).await?;
        if file.metadata().await?.len() != self.file_len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "bad note file size",
            ));
        }
        let mut nonce_prefix = [0u8; NONCE_PREFIX_LEN];
        file.read_exact(&mut nonce_prefix).await?;
        let decryptor = DecryptorBE32::from_aead(
            self.store.cipher.clone(),
            GenericArray::from_slice(&nonce_prefix),
        );
        let remaining = self.len;
        Ok(futures_util::stream::try_unfold(
            (self, file, Some(decryptor), remaining),
            |(note_file, mut file, decryptor, remaining)| async move {
                let Some(mut decryptor) = decryptor else {
                    return Ok(None);
                };
                let chunk_len = remaining.min(CHUNK_LEN);
                let mut buffer = vec![0; chunk_len + TAG_LEN];
                file.read_exact(&mut buffer).await?;
                let remaining = remaining - chunk_len;
                let decryptor = if remaining == 0 {
                    decryptor
                        .decrypt_last_in_place(note_file.aad(), &mut buffer)
                        .map_err(crypto_error)?;
                    None
                } else {
                    decryptor
                        .decrypt_next_in_place(note_file.aad(), &mut buffer)
                        .map_err(crypto_error)?;
                    Some(decryptor)
                };
                Ok(Some((
                    Bytes::from(buffer),
                    (note_file, file, decryptor, remaining),
                )))
            },
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let name: u64 = rand::rng().random();
        std::env::temp_dir().join(format!("rsecnotes-test-{name:x}"))
    }

    /// `data` split in frames of `frame_len` bytes
    fn body(data: &[u8], frame_len: usize) -> impl Stream<Item = io::Result<Bytes>> + Unpin {
        let frames: Vec<_> = data
            .chunks(frame_len)
            .map(|frame| Ok(Bytes::copy_from_slice(frame)))
            .collect();
        futures_util::stream::iter(frames)
    }

    async fn read_all(file: Arc<NoteFile>) -> io::Result<Vec<u8>> {
        let mut stream = std::pin::pin!(file.read().await?);
        let mut data = Vec::new();
        while let Some(chunk) = stream.next().await {
            data.extend_from_slice(&chunk?);
        }
        Ok(data)
    }

    #[tokio::test]
    async fn roundtrip_and_remove_on_drop() {
        let dir = temp_dir();
        let store = FileStore::new(&dir).unwrap();
        for len in [
            0,
            1,
            CHUNK_LEN - 1,
            CHUNK_LEN,
            CHUNK_LEN + 1,
            3 * CHUNK_LEN + 7,
        ] {
            let data: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
            for frame_len in [1000, CHUNK_LEN + 3] {
                let file = store.write(len, body(&data, frame_len)).await.unwrap();
                let path = file.path.clone();
                assert_eq!(fs::metadata(&path).unwrap().len(), file.file_len());
                let file = Arc::new(file);
                assert!(read_all(file.clone()).await.unwrap() == data, "len {len}");
                drop(file);
                assert!(!path.exists());
            }
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn wrong_length_is_rejected_and_removed() {
        let dir = temp_dir();
        let store = FileStore::new(&dir).unwrap();
        let data = vec![1u8; 2 * CHUNK_LEN];
        assert!(
            store
                .write(data.len() + 1, body(&data, 1000))
                .await
                .is_err()
        );
        assert!(
            store
                .write(data.len() - 1, body(&data, 1000))
                .await
                .is_err()
        );
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn tampered_file_is_rejected() {
        let dir = temp_dir();
        let store = FileStore::new(&dir).unwrap();
        let data = b"secret note".repeat(CHUNK_LEN / 4);
        let file = Arc::new(store.write(data.len(), body(&data, 1000)).await.unwrap());
        let mut on_disk = fs::read(&file.path).unwrap();
        assert!(!on_disk.windows(6).any(|w| w == b"secret"));
        *on_disk.last_mut().unwrap() ^= 1;
        fs::write(&file.path, &on_disk).unwrap();
        assert!(read_all(file).await.is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn new_only_removes_note_files() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("old.note"), b"old").unwrap();
        fs::write(dir.join("keep.txt"), b"keep").unwrap();
        let _store = FileStore::new(&dir).unwrap();
        assert!(!dir.join("old.note").exists());
        assert!(dir.join("keep.txt").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
