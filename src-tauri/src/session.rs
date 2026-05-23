use anyhow::{bail, Context, Result};
use std::fmt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const RMUX_BIN: &str = "rmux";
const DEFAULT_SESSION_NAME: &str = "claude";
const DEFAULT_SESSION_COMMAND: &str = "claude";

/// A command represented without shell interpolation.
///
/// Keeping command construction separate from execution lets us unit-test the
/// rmux argv shape without requiring rmux to be installed locally.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
}

impl CommandSpec {
    pub fn new(program: impl Into<String>, args: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            program: program.into(),
            args: args.into_iter().map(Into::into).collect(),
        }
    }

    fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.args);
        command
    }
}

impl fmt::Display for CommandSpec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.program)?;
        for arg in &self.args {
            write!(f, " {}", arg)?;
        }
        Ok(())
    }
}

/// Configuration for a named rmux-backed Stained Glass session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionConfig {
    /// rmux session name. Defaults to `claude`.
    pub name: String,
    /// Command started inside a new detached rmux session. Defaults to `claude`.
    pub cmd: String,
    /// Working directory for newly-created rmux sessions.
    pub cwd: PathBuf,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            name: DEFAULT_SESSION_NAME.into(),
            cmd: DEFAULT_SESSION_COMMAND.into(),
            cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        }
    }
}

impl SessionConfig {
    pub fn new(
        name: impl Into<String>,
        cmd: impl Into<String>,
        cwd: impl Into<PathBuf>,
    ) -> Self {
        Self {
            name: name.into(),
            cmd: cmd.into(),
            cwd: cwd.into(),
        }
    }

    pub fn default_session_name() -> &'static str {
        DEFAULT_SESSION_NAME
    }

    pub fn default_session_command() -> &'static str {
        DEFAULT_SESSION_COMMAND
    }

    /// Returns true when the named rmux session exists.
    ///
    /// Missing rmux or other execution failures are returned as errors instead
    /// of being collapsed into `false`, so callers can surface actionable
    /// runtime failures to the UI.
    pub fn exists(&self) -> Result<bool> {
        let spec = self.has_session_command();
        let output = self.run_output(spec.clone())?;
        if output.status.success() {
            return Ok(true);
        }

        if is_missing_session_output(&output) {
            return Ok(false);
        }

        bail!("{}", format_command_failure(&spec, &output));
    }

    /// Creates a detached rmux session running `cmd` in `cwd`.
    pub fn create(&self) -> Result<()> {
        self.run_success(self.create_command())
    }

    /// Ensures the session exists, creating it when necessary.
    pub fn ensure_created(&self) -> Result<()> {
        if !self.exists()? {
            self.create()?;
        }
        Ok(())
    }

    /// Returns the argv used by the PTY layer to attach to this rmux session.
    pub fn attach_cmd(&self) -> Vec<String> {
        let spec = self.attach_command();
        let mut argv = Vec::with_capacity(spec.args.len() + 1);
        argv.push(spec.program);
        argv.extend(spec.args);
        argv
    }

    /// Kills the rmux session.
    pub fn kill(&self) -> Result<()> {
        self.run_success(self.kill_command())
    }

    pub fn has_session_command(&self) -> CommandSpec {
        CommandSpec::new(RMUX_BIN, ["has-session", "-t", self.name.as_str()])
    }

    pub fn create_command(&self) -> CommandSpec {
        CommandSpec::new(
            RMUX_BIN,
            [
                "new-session",
                "-d",
                "-s",
                self.name.as_str(),
                "-c",
                path_to_str(&self.cwd),
                self.cmd.as_str(),
            ],
        )
    }

    pub fn attach_command(&self) -> CommandSpec {
        CommandSpec::new(RMUX_BIN, ["attach-session", "-t", self.name.as_str()])
    }

    pub fn kill_command(&self) -> CommandSpec {
        CommandSpec::new(RMUX_BIN, ["kill-session", "-t", self.name.as_str()])
    }

    fn run_success(&self, spec: CommandSpec) -> Result<()> {
        let output = self.run_output(spec.clone())?;
        if !output.status.success() {
            bail!("{}", format_command_failure(&spec, &output));
        }
        Ok(())
    }

    fn run_output(&self, spec: CommandSpec) -> Result<Output> {
        spec.command()
            .output()
            .with_context(|| format!("failed to execute `{}`; is `{}` installed and in PATH?", spec, spec.program))
    }
}

/// Lists active rmux session names.
pub fn list_sessions() -> Result<Vec<String>> {
    let spec = CommandSpec::new(RMUX_BIN, ["list-sessions", "-F", "#{session_name}"]);
    let output = spec
        .command()
        .output()
        .with_context(|| format!("failed to execute `{}`; is `{}` installed and in PATH?", spec, spec.program))?;

    if !output.status.success() {
        bail!("{}", format_command_failure(&spec, &output));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect())
}

fn path_to_str(path: &Path) -> &str {
    path.to_str().unwrap_or(".")
}

fn is_missing_session_output(output: &Output) -> bool {
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
    .to_ascii_lowercase();

    combined.contains("can't find session")
        || combined.contains("cannot find session")
        || combined.contains("session not found")
        || combined.contains("no server running")
}

fn format_command_failure(spec: &CommandSpec, output: &Output) -> String {
    let code = output
        .status
        .code()
        .map_or_else(|| "terminated by signal".to_string(), |code| code.to_string());
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => format!("`{}` failed with exit status {}", spec, code),
        (false, true) => format!("`{}` failed with exit status {}: {}", spec, code, stdout),
        (true, false) => format!("`{}` failed with exit status {}: {}", spec, code, stderr),
        (false, false) => format!(
            "`{}` failed with exit status {}: stdout: {}; stderr: {}",
            spec, code, stdout, stderr
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> SessionConfig {
        SessionConfig::new("claude", "claude", "/tmp/stained-glass")
    }

    #[test]
    fn defaults_match_spec() {
        let config = SessionConfig::default();
        assert_eq!(config.name, "claude");
        assert_eq!(config.cmd, "claude");
        assert_eq!(SessionConfig::default_session_name(), "claude");
        assert_eq!(SessionConfig::default_session_command(), "claude");
    }

    #[test]
    fn constructs_has_session_command() {
        assert_eq!(
            config().has_session_command(),
            CommandSpec::new("rmux", ["has-session", "-t", "claude"])
        );
    }

    #[test]
    fn constructs_detached_create_command() {
        assert_eq!(
            config().create_command(),
            CommandSpec::new(
                "rmux",
                [
                    "new-session",
                    "-d",
                    "-s",
                    "claude",
                    "-c",
                    "/tmp/stained-glass",
                    "claude",
                ]
            )
        );
    }

    #[test]
    fn constructs_attach_argv_for_pty_target() {
        assert_eq!(
            config().attach_cmd(),
            vec!["rmux", "attach-session", "-t", "claude"]
        );
    }

    #[test]
    fn constructs_kill_command() {
        assert_eq!(
            config().kill_command(),
            CommandSpec::new("rmux", ["kill-session", "-t", "claude"])
        );
    }
}
