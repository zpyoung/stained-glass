use crate::pty::{spawn_pty, PtyHandle};
use crate::session::SessionConfig;
use crate::snapshot::{spawn_snapshot_stream, SnapshotHandle};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

const SNAPSHOT_INTERVAL: Duration = Duration::from_millis(300);

pub struct AppState {
    pty: Mutex<Option<PtyHandle>>,
    snapshot: Mutex<Option<SnapshotHandle>>,
    session_name: Mutex<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            pty: Mutex::new(None),
            snapshot: Mutex::new(None),
            session_name: Mutex::new(SessionConfig::default_session_name().into()),
        }
    }
}

#[tauri::command]
pub async fn start_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_name: String,
    cmd: String,
    cwd: String,
) -> Result<(), String> {
    let session_name = default_if_blank(session_name, SessionConfig::default_session_name());
    let cmd = default_if_blank(cmd, SessionConfig::default_session_command());
    let cwd = if cwd.trim().is_empty() { ".".into() } else { cwd };

    let config = SessionConfig::new(session_name.clone(), cmd, PathBuf::from(cwd));
    config.ensure_created().map_err(|err| err.to_string())?;

    let pty = spawn_pty(config.attach_cmd(), 220, 50)
        .await
        .map_err(|err| err.to_string())?;
    forward_pty_events(app.clone(), pty.subscribe());

    let snapshot = spawn_snapshot_stream(session_name.clone(), SNAPSHOT_INTERVAL);
    forward_snapshot_events(app, snapshot.subscribe());

    *state.session_name.lock().await = session_name;
    *state.pty.lock().await = Some(pty);
    *state.snapshot.lock().await = Some(snapshot);

    Ok(())
}

#[tauri::command]
pub async fn send_input(state: State<'_, AppState>, data: String) -> Result<(), String> {
    let input_tx = {
        let pty = state.pty.lock().await;
        let Some(pty) = pty.as_ref() else {
            return Err("no active PTY session; call start_session first".into());
        };
        pty.input_tx.clone()
    };

    input_tx
        .send(data.into_bytes())
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn resize_pty(
    _state: State<'_, AppState>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Resize is intentionally a no-op until the PTY owner keeps a resize-capable
    // master handle instead of split read/write halves. The command exists now
    // so the frontend payload shape is stable.
    let _ = (cols, rows);
    Ok(())
}

#[tauri::command]
pub async fn kill_session(state: State<'_, AppState>) -> Result<(), String> {
    state.pty.lock().await.take();
    state.snapshot.lock().await.take();

    let session_name = state.session_name.lock().await.clone();
    let config = SessionConfig::new(session_name, SessionConfig::default_session_command(), ".");
    config.kill().map_err(|err| err.to_string())
}

fn forward_pty_events(app: AppHandle, mut output_rx: tokio::sync::broadcast::Receiver<Vec<u8>>) {
    tokio::spawn(async move {
        loop {
            match output_rx.recv().await {
                Ok(data) => {
                    let payload = String::from_utf8_lossy(&data).to_string();
                    let _ = app.emit("pty-data", payload);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

fn forward_snapshot_events(
    app: AppHandle,
    mut snapshot_rx: tokio::sync::broadcast::Receiver<String>,
) {
    tokio::spawn(async move {
        loop {
            match snapshot_rx.recv().await {
                Ok(payload) => {
                    let _ = app.emit("pane-snapshot", payload);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

fn default_if_blank(value: String, fallback: &str) -> String {
    if value.trim().is_empty() {
        fallback.into()
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_session_values_use_spec_defaults() {
        assert_eq!(default_if_blank("".into(), "claude"), "claude");
        assert_eq!(default_if_blank("   ".into(), "claude"), "claude");
    }

    #[test]
    fn non_blank_session_values_are_preserved() {
        assert_eq!(default_if_blank("work".into(), "claude"), "work");
    }
}
