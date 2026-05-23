use anyhow::{bail, Context, Result};
use std::process::{Command, Output};
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

const RMUX_BIN: &str = "rmux";
const SNAPSHOT_CHANNEL_CAPACITY: usize = 64;

/// Captures a visible rmux pane and returns ANSI-free plain text.
pub fn capture_pane(session: &str) -> Result<String> {
    let output = Command::new(RMUX_BIN)
        .args(capture_pane_args(session))
        .output()
        .with_context(|| format!("failed to execute `rmux capture-pane`; is `{RMUX_BIN}` installed and in PATH?"))?;

    if !output.status.success() {
        bail!("{}", format_capture_failure(session, &output));
    }

    Ok(strip_ansi(&String::from_utf8_lossy(&output.stdout)))
}

/// rmux argv for visible-pane capture.
///
/// `-p` prints pane contents to stdout and `-e` includes escape sequences so
/// this module owns the ANSI-stripping boundary before text reaches preview.
pub fn capture_pane_args(session: &str) -> [&str; 5] {
    ["capture-pane", "-p", "-e", "-t", session]
}

pub fn strip_ansi(text: &str) -> String {
    strip_ansi_escapes::strip_str(text)
}

pub struct SnapshotHandle {
    pub snapshot_tx: broadcast::Sender<String>,
    task: JoinHandle<()>,
}

impl SnapshotHandle {
    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.snapshot_tx.subscribe()
    }

    pub fn shutdown(&self) {
        self.task.abort();
    }
}

impl Drop for SnapshotHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Start a periodic plain-text markdown snapshot stream for a session.
///
/// Capture failures are skipped inside the loop so a transient rmux failure does
/// not panic or tear down the app. Direct callers can use `capture_pane()` when
/// they need the clear error for a single capture attempt.
pub fn spawn_snapshot_stream(session: impl Into<String>, every: Duration) -> SnapshotHandle {
    let session = session.into();
    let (snapshot_tx, _) = broadcast::channel::<String>(SNAPSHOT_CHANNEL_CAPACITY);
    let task_tx = snapshot_tx.clone();

    let task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(every);
        loop {
            interval.tick().await;
            let session_for_capture = session.clone();
            let Ok(Ok(snapshot)) = tokio::task::spawn_blocking(move || capture_pane(&session_for_capture)).await else {
                continue;
            };
            if let Some(payload) = preview_payload_from_plain_snapshot(&snapshot) {
                let _ = task_tx.send(payload);
            }
        }
    });

    SnapshotHandle { snapshot_tx, task }
}

pub fn preview_payload_from_raw_snapshot(raw: &str) -> Option<String> {
    preview_payload_from_plain_snapshot(&strip_ansi(raw))
}

pub fn preview_payload_from_plain_snapshot(snapshot: &str) -> Option<String> {
    let markdown = extract_markdown(snapshot);
    if markdown.is_empty() {
        None
    } else {
        Some(markdown)
    }
}

/// Extract markdown-oriented content from a plain-text terminal snapshot.
///
/// This deliberately favors a small set of obvious markdown signals. It skips
/// shell/Claude prompt noise before the first markdown line, keeps fenced-code
/// bodies intact, and includes normal continuation lines once a markdown block
/// has started.
pub fn extract_markdown(text: &str) -> String {
    let mut result = Vec::new();
    let mut in_fence = false;
    let mut collecting = false;

    for raw_line in text.lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim_start();
        let starts_fence = trimmed.starts_with("```") || trimmed.starts_with("~~~");

        if starts_fence {
            in_fence = !in_fence;
            collecting = true;
            result.push(line);
            continue;
        }

        if in_fence {
            result.push(line);
            continue;
        }

        if is_markdown_signal(trimmed) {
            collecting = true;
            result.push(line);
            continue;
        }

        if collecting && (line.is_empty() || is_likely_markdown_continuation(trimmed)) {
            result.push(line);
        }
    }

    trim_blank_edges(result).join("\n")
}

fn is_markdown_signal(line: &str) -> bool {
    line.starts_with('#')
        || line.starts_with("- ")
        || line.starts_with("* ")
        || line.starts_with("+ ")
        || line.starts_with("> ")
        || line.starts_with("| ")
        || line.contains("**")
        || line.contains('`')
        || is_ordered_list_item(line)
}

fn is_likely_markdown_continuation(line: &str) -> bool {
    !line.starts_with('$')
        && !line.starts_with('>')
        && !line.starts_with("claude")
        && !line.starts_with("Claude")
}

fn is_ordered_list_item(line: &str) -> bool {
    let Some((digits, rest)) = line.split_once(". ") else {
        return false;
    };
    !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) && !rest.trim().is_empty()
}

fn trim_blank_edges(mut lines: Vec<&str>) -> Vec<&str> {
    while lines.first().is_some_and(|line| line.trim().is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }
    lines
}

fn format_capture_failure(session: &str, output: &Output) -> String {
    let code = output
        .status
        .code()
        .map_or_else(|| "terminated by signal".to_string(), |code| code.to_string());
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => format!("`rmux capture-pane -p -e -t {session}` failed with exit status {code}"),
        (false, true) => format!("`rmux capture-pane -p -e -t {session}` failed with exit status {code}: {stdout}"),
        (true, false) => format!("`rmux capture-pane -p -e -t {session}` failed with exit status {code}: {stderr}"),
        (false, false) => format!(
            "`rmux capture-pane -p -e -t {session}` failed with exit status {code}: stdout: {stdout}; stderr: {stderr}"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_command_uses_plain_print_and_escape_capture() {
        assert_eq!(
            capture_pane_args("claude"),
            ["capture-pane", "-p", "-e", "-t", "claude"]
        );
    }

    #[test]
    fn strips_ansi_sequences_before_preview() {
        assert_eq!(strip_ansi("\u{1b}[31m# Red\u{1b}[0m"), "# Red");
    }

    #[test]
    fn raw_preview_payload_strips_ansi_before_extracting_markdown() {
        assert_eq!(
            preview_payload_from_raw_snapshot("noise\n\u{1b}[32m# Clean\u{1b}[0m\n"),
            Some("# Clean".into())
        );
    }

    #[test]
    fn plain_preview_payload_omits_empty_markdown() {
        assert_eq!(preview_payload_from_plain_snapshot("$ ls\nsrc\n"), None);
    }

    #[test]
    fn extracts_headings_and_paragraph_continuations_after_noise() {
        let text = "$ claude\nworking...\n# Title\nA useful paragraph.\n";
        assert_eq!(extract_markdown(text), "# Title\nA useful paragraph.");
    }

    #[test]
    fn extracts_unordered_and_ordered_lists() {
        let text = "noise\n- first\n- second\n1. ordered\n2. next\n";
        assert_eq!(extract_markdown(text), "- first\n- second\n1. ordered\n2. next");
    }

    #[test]
    fn extracts_blockquotes() {
        let text = "status: ok\n> quoted\n> still quoted\n";
        assert_eq!(extract_markdown(text), "> quoted\n> still quoted");
    }

    #[test]
    fn keeps_code_fence_bodies_intact() {
        let text = "terminal noise\n```rust\nfn main() {}\n```\n$ prompt\n";
        assert_eq!(extract_markdown(text), "```rust\nfn main() {}\n```");
    }

    #[test]
    fn extracts_markdown_tables() {
        let text = "noise\n| Name | Value |\n|---|---|\n| alpha | beta |\n";
        assert_eq!(
            extract_markdown(text),
            "| Name | Value |\n|---|---|\n| alpha | beta |"
        );
    }

    #[test]
    fn ignores_normal_terminal_noise_when_no_markdown_exists() {
        let text = "$ ls\ntarget\nsrc\n$ echo done\ndone\n";
        assert_eq!(extract_markdown(text), "");
    }
}
