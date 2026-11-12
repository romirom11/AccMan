//! `clipboard.rs`: clipboard writes that can be cleared later, but only while the clipboard
//! still holds exactly what this app put there (so a later copy by the user is never wiped).
//!
//! Reading the clipboard must not happen on the main thread (it can deadlock on Linux), so the
//! callers run these functions on a blocking worker.

use std::sync::Mutex;
use std::time::Duration;

use log::warn;
use ring::digest;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::error::{CommandError, CommandResult};

pub const MAX_CLEAR_AFTER_SECONDS: u32 = 3600;

#[derive(Default)]
struct Inner {
    /// SHA-256 of the last text this app wrote; None when the app does not own the clipboard.
    owned: Option<[u8; 32]>,
    /// Incremented on every copy/clear so stale timers do nothing.
    generation: u64,
}

#[derive(Default)]
pub struct ClipboardState {
    inner: Mutex<Inner>,
}

fn hash(text: &str) -> [u8; 32] {
    let digest = digest::digest(&digest::SHA256, text.as_bytes());
    let mut out = [0u8; 32];
    out.copy_from_slice(digest.as_ref());
    out
}

fn clipboard_error(err: impl std::fmt::Display) -> CommandError {
    CommandError::internal(format!("Could not access the clipboard: {err}"))
}

impl ClipboardState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Writes `text` and, when `clear_after_seconds > 0`, schedules a conditional clear.
pub fn copy<R: Runtime>(app: &AppHandle<R>, text: &str, clear_after_seconds: Option<u32>) -> CommandResult<()> {
    let state = app.state::<ClipboardState>();
    let generation = {
        let mut inner = state.lock();
        app.clipboard().write_text(text).map_err(clipboard_error)?;
        inner.owned = Some(hash(text));
        inner.generation = inner.generation.wrapping_add(1);
        inner.generation
    };

    let seconds = clear_after_seconds.unwrap_or(0).min(MAX_CLEAR_AFTER_SECONDS);
    if seconds > 0 {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(seconds as u64));
            if let Err(e) = clear_owned(&app, Some(generation)) {
                warn!("Scheduled clipboard clear failed: {e}");
            }
        });
    }
    Ok(())
}

/// Clears the clipboard if it still holds the text this app wrote last.
/// Returns true when it was cleared.
pub fn clear_if_owned<R: Runtime>(app: &AppHandle<R>) -> CommandResult<bool> {
    clear_owned(app, None)
}

fn clear_owned<R: Runtime>(app: &AppHandle<R>, only_generation: Option<u64>) -> CommandResult<bool> {
    let state = app.state::<ClipboardState>();
    let mut inner = state.lock();
    if only_generation.is_some_and(|g| g != inner.generation) {
        return Ok(false);
    }
    let Some(owned) = inner.owned else {
        return Ok(false);
    };
    inner.owned = None;
    inner.generation = inner.generation.wrapping_add(1);

    let clipboard = app.clipboard();
    let still_ours = match clipboard.read_text() {
        Ok(current) => hash(&current) == owned,
        // Non-text content means someone else copied something.
        Err(_) => false,
    };
    if !still_ours {
        return Ok(false);
    }
    if clipboard.clear().is_err() {
        clipboard.write_text("").map_err(clipboard_error)?;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_stable_and_distinct() {
        assert_eq!(hash("abc"), hash("abc"));
        assert_ne!(hash("abc"), hash("abd"));
    }
}
