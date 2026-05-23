use anyhow::{bail, Context, Result};
use rust_pty::{NativePtySystem, PtyConfig, PtySystem};
use std::ffi::OsString;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

const DEFAULT_OUTPUT_CHANNEL_CAPACITY: usize = 256;
const DEFAULT_INPUT_CHANNEL_CAPACITY: usize = 64;
const READ_BUFFER_SIZE: usize = 4096;

/// Async handle for an attached pseudo-terminal.
///
/// Raw PTY output is broadcast to subscribers. Input bytes are sent through an
/// mpsc channel so Tauri IPC can forward frontend keystrokes without directly
/// owning the PTY writer.
pub struct PtyHandle {
    pub output_tx: broadcast::Sender<Vec<u8>>,
    pub input_tx: mpsc::Sender<Vec<u8>>,
    tasks: Vec<JoinHandle<()>>,
}

impl PtyHandle {
    pub fn subscribe(&self) -> broadcast::Receiver<Vec<u8>> {
        self.output_tx.subscribe()
    }

    pub async fn send_input(&self, data: impl Into<Vec<u8>>) -> Result<()> {
        self.input_tx
            .send(data.into())
            .await
            .context("failed to send input to PTY writer task")
    }

    /// Abort background read/write/wait tasks.
    ///
    /// Normal task failure is handled inside each task without panicking; this
    /// method is for explicit shutdown when the owning app state drops or
    /// replaces a PTY handle.
    pub fn shutdown(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

impl Drop for PtyHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Spawn `argv[0]` and `argv[1..]` inside a pseudo-terminal.
///
/// For Stained Glass this is expected to be the rmux attach argv returned by
/// `SessionConfig::attach_cmd()`, e.g. `rmux attach-session -t claude`.
pub async fn spawn_pty(argv: Vec<String>, cols: u16, rows: u16) -> Result<PtyHandle> {
    let (program, args) = split_argv(&argv)?;
    let mut config = PtyConfig {
        window_size: (cols, rows),
        ..PtyConfig::default()
    };
    config
        .env_add
        .insert(OsString::from("TERM"), OsString::from("xterm-256color"));

    let (master, mut child) = NativePtySystem::spawn(program, args, &config)
        .await
        .with_context(|| format!("failed to spawn PTY command `{}`", format_argv(&argv)))?;

    let (mut pty_read, mut pty_write) = tokio::io::split(master);
    let (output_tx, _) = broadcast::channel::<Vec<u8>>(DEFAULT_OUTPUT_CHANNEL_CAPACITY);
    let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(DEFAULT_INPUT_CHANNEL_CAPACITY);

    let read_output_tx = output_tx.clone();
    let read_task = tokio::spawn(async move {
        let mut buf = vec![0_u8; READ_BUFFER_SIZE];
        loop {
            match pty_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let _ = read_output_tx.send(buf[..n].to_vec());
                }
                Err(_) => break,
            }
        }
    });

    let write_task = tokio::spawn(async move {
        while let Some(data) = input_rx.recv().await {
            if pty_write.write_all(&data).await.is_err() {
                break;
            }
        }
    });

    let wait_task = tokio::spawn(async move {
        let _ = child.wait().await;
    });

    Ok(PtyHandle {
        output_tx,
        input_tx,
        tasks: vec![read_task, write_task, wait_task],
    })
}

/// Resize support is intentionally deferred until the IPC layer owns PTY state.
///
/// The selected `rust-pty` crate exposes resize on the master PTY, but this
/// issue splits the master into read/write halves for safe async I/O. Issue #9
/// can introduce a stateful owner if live resize is required by the frontend.
pub fn resize_follow_up_note() -> &'static str {
    "PTY resize is deferred until the IPC/app-state layer owns a resize-capable PTY master."
}

fn split_argv(argv: &[String]) -> Result<(&str, Vec<&str>)> {
    let Some((program, args)) = argv.split_first() else {
        bail!("cannot spawn PTY without a program argument");
    };

    if program.trim().is_empty() {
        bail!("cannot spawn PTY with an empty program argument");
    }

    Ok((program.as_str(), args.iter().map(String::as_str).collect()))
}

fn format_argv(argv: &[String]) -> String {
    argv.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{timeout, Duration};

    #[test]
    fn split_argv_rejects_empty_argv() {
        let err = split_argv(&[]).expect_err("empty argv should fail");
        assert!(err.to_string().contains("without a program"));
    }

    #[test]
    fn split_argv_rejects_empty_program() {
        let err = split_argv(&["".into()]).expect_err("empty program should fail");
        assert!(err.to_string().contains("empty program"));
    }

    #[test]
    fn split_argv_separates_program_from_args() {
        let argv = vec!["rmux".into(), "attach-session".into(), "-t".into(), "claude".into()];
        let (program, args) = split_argv(&argv).expect("argv should split");
        assert_eq!(program, "rmux");
        assert_eq!(args, vec!["attach-session", "-t", "claude"]);
    }

    #[test]
    fn documents_resize_follow_up() {
        assert!(resize_follow_up_note().contains("deferred"));
    }

    /// Manual/local smoke path for issue #7.
    ///
    /// Run with a Rust toolchain installed:
    /// `cargo test -p stained-glass pty::tests::smoke_cat_echoes_input -- --ignored`
    #[tokio::test]
    #[ignore = "requires local Rust toolchain and /bin/cat PTY smoke support"]
    async fn smoke_cat_echoes_input() {
        let handle = spawn_pty(vec!["/bin/cat".into()], 80, 24)
            .await
            .expect("spawn cat in pty");
        let mut output = handle.subscribe();

        handle
            .send_input(b"stained-glass-smoke\n".to_vec())
            .await
            .expect("write smoke input");

        let bytes = timeout(Duration::from_secs(3), output.recv())
            .await
            .expect("timely pty output")
            .expect("broadcast output");
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("stained-glass-smoke"));
    }
}
