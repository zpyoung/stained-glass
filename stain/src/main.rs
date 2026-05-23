use anyhow::{bail, Context, Result};
use clap::{Args, Parser, Subcommand};
use std::env;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};

const DEFAULT_SESSION: &str = "claude";
const DEFAULT_COMMAND: &str = "claude";
const RMUX_BIN: &str = "rmux";

#[derive(Debug, Parser)]
#[command(name = "stain")]
#[command(about = "Control Stained Glass rmux sessions and pane snapshots")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// Create or reuse a session, then launch the Stained Glass GUI when possible.
    Open(OpenArgs),
    /// Attach the current terminal directly to an existing rmux session.
    Attach(SessionArgs),
    /// List active rmux sessions.
    List,
    /// Kill a named rmux session.
    Kill(SessionArgs),
    /// Print a plain-text snapshot of the current pane.
    Snap(SessionArgs),
    /// Send text to an existing rmux session.
    Send(SendArgs),
}

#[derive(Debug, Args)]
struct SessionArgs {
    /// rmux session name.
    #[arg(long, default_value = DEFAULT_SESSION)]
    session: String,
}

#[derive(Debug, Args)]
struct OpenArgs {
    /// rmux session name.
    #[arg(long, default_value = DEFAULT_SESSION)]
    session: String,
    /// Command to start inside a newly-created session.
    #[arg(long, default_value = DEFAULT_COMMAND)]
    cmd: String,
    /// Working directory for newly-created sessions.
    #[arg(long)]
    cwd: Option<PathBuf>,
    /// Ensure the rmux session only; do not launch the GUI.
    #[arg(long)]
    no_gui: bool,
}

#[derive(Debug, Args)]
struct SendArgs {
    /// rmux session name.
    #[arg(long, default_value = DEFAULT_SESSION)]
    session: String,
    /// Text to send to the rmux pane.
    #[arg(long)]
    text: String,
    /// Press Enter after sending the text.
    #[arg(long)]
    enter: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CommandSpec {
    program: String,
    args: Vec<String>,
}

impl CommandSpec {
    fn new(program: impl Into<String>, args: impl IntoIterator<Item = impl Into<String>>) -> Self {
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

    fn display(&self) -> String {
        std::iter::once(self.program.as_str())
            .chain(self.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

fn main() {
    if let Err(error) = run(Cli::parse()) {
        eprintln!("stain: {error:#}");
        std::process::exit(1);
    }
}

fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Commands::Open(args) => open(args),
        Commands::Attach(args) => attach(&args.session),
        Commands::List => list(),
        Commands::Kill(args) => kill(&args.session),
        Commands::Snap(args) => snap(&args.session),
        Commands::Send(args) => send(&args.session, &args.text, args.enter),
    }
}

fn open(args: OpenArgs) -> Result<()> {
    let cwd = args
        .cwd
        .unwrap_or(env::current_dir().context("could not resolve current working directory")?);
    ensure_session(&args.session, &args.cmd, &cwd)?;

    if args.no_gui {
        println!("session `{}` is ready", args.session);
        return Ok(());
    }

    launch_gui().context("session is ready, but the Stained Glass GUI could not be launched")
}

fn attach(session: &str) -> Result<()> {
    let spec = attach_command(session);
    let status = spec
        .command()
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .with_context(|| format_missing_binary(&spec))?;

    if !status.success() {
        bail!("`{}` exited with status {}", spec.display(), status);
    }
    Ok(())
}

fn list() -> Result<()> {
    let spec = list_command();
    let output = run_output(&spec)?;
    if !output.status.success() {
        bail!("{}", format_command_failure(&spec, &output));
    }
    print!("{}", String::from_utf8_lossy(&output.stdout));
    Ok(())
}

fn kill(session: &str) -> Result<()> {
    let spec = kill_command(session);
    let output = run_output(&spec)?;
    if !output.status.success() {
        bail!("{}", format_command_failure(&spec, &output));
    }
    Ok(())
}

fn snap(session: &str) -> Result<()> {
    let spec = snap_command(session);
    let output = run_output(&spec)?;
    if !output.status.success() {
        bail!("{}", format_command_failure(&spec, &output));
    }
    print!("{}", strip_ansi(&String::from_utf8_lossy(&output.stdout)));
    Ok(())
}

fn send(session: &str, text: &str, enter: bool) -> Result<()> {
    let spec = send_command(session, text, enter);
    let output = run_output(&spec)?;
    if !output.status.success() {
        bail!("{}", format_command_failure(&spec, &output));
    }
    Ok(())
}

fn ensure_session(session: &str, cmd: &str, cwd: &PathBuf) -> Result<()> {
    let has = has_session_command(session);
    let output = run_output(&has)?;
    if output.status.success() {
        return Ok(());
    }
    if !is_missing_session_output(&output) {
        bail!("{}", format_command_failure(&has, &output));
    }

    let create = create_command(session, cmd, cwd);
    let output = run_output(&create)?;
    if !output.status.success() {
        bail!("{}", format_command_failure(&create, &output));
    }
    Ok(())
}

fn launch_gui() -> Result<()> {
    if let Ok(command) = env::var("STAINED_GLASS_APP") {
        return spawn_gui(CommandSpec::new(command, [] as [&str; 0]));
    }

    launch_default_gui()
}

#[cfg(target_os = "macos")]
fn launch_default_gui() -> Result<()> {
    spawn_gui(CommandSpec::new("open", ["-a", "Stained Glass"]))
}

#[cfg(target_os = "linux")]
fn launch_default_gui() -> Result<()> {
    spawn_gui(CommandSpec::new("gtk-launch", ["stained-glass"])).or_else(|_| {
        spawn_gui(CommandSpec::new("xdg-open", ["stained-glass://open"] as [&str; 1]))
    })
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn launch_default_gui() -> Result<()> {
    bail!("automatic GUI launch is not configured for this platform; run `stain attach` or launch Stained Glass manually")
}

fn spawn_gui(spec: CommandSpec) -> Result<()> {
    spec.command()
        .spawn()
        .with_context(|| format!("failed to launch `{}`", spec.display()))?;
    Ok(())
}

fn has_session_command(session: &str) -> CommandSpec {
    CommandSpec::new(RMUX_BIN, ["has-session", "-t", session])
}

fn create_command(session: &str, cmd: &str, cwd: &PathBuf) -> CommandSpec {
    CommandSpec::new(
        RMUX_BIN,
        [
            "new-session".to_string(),
            "-d".to_string(),
            "-s".to_string(),
            session.to_string(),
            "-c".to_string(),
            cwd.display().to_string(),
            cmd.to_string(),
        ],
    )
}

fn attach_command(session: &str) -> CommandSpec {
    CommandSpec::new(RMUX_BIN, ["attach-session", "-t", session])
}

fn list_command() -> CommandSpec {
    CommandSpec::new(RMUX_BIN, ["list-sessions", "-F", "#{session_name}"])
}

fn kill_command(session: &str) -> CommandSpec {
    CommandSpec::new(RMUX_BIN, ["kill-session", "-t", session])
}

fn snap_command(session: &str) -> CommandSpec {
    CommandSpec::new(RMUX_BIN, ["capture-pane", "-p", "-e", "-t", session])
}

fn send_command(session: &str, text: &str, enter: bool) -> CommandSpec {
    let mut args = vec![
        "send-keys".to_string(),
        "-t".to_string(),
        session.to_string(),
        text.to_string(),
    ];
    if enter {
        args.push("Enter".to_string());
    }
    CommandSpec::new(RMUX_BIN, args)
}

fn run_output(spec: &CommandSpec) -> Result<Output> {
    spec.command()
        .output()
        .with_context(|| format_missing_binary(spec))
}

fn format_missing_binary(spec: &CommandSpec) -> String {
    format!(
        "failed to execute `{}`; is `{}` installed and in PATH?",
        spec.display(), spec.program
    )
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
        (true, true) => format!("`{}` failed with exit status {}", spec.display(), code),
        (false, true) => format!("`{}` failed with exit status {}: {}", spec.display(), code, stdout),
        (true, false) => format!("`{}` failed with exit status {}: {}", spec.display(), code, stderr),
        (false, false) => format!(
            "`{}` failed with exit status {}: stdout: {}; stderr: {}",
            spec.display(), code, stdout, stderr
        ),
    }
}

fn strip_ansi(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
            continue;
        }
        output.push(ch);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constructs_open_create_command() {
        assert_eq!(
            create_command("demo", "claude", &PathBuf::from("/tmp/demo")),
            CommandSpec::new(
                "rmux",
                ["new-session", "-d", "-s", "demo", "-c", "/tmp/demo", "claude"]
            )
        );
    }

    #[test]
    fn constructs_attach_list_kill_snap_and_send_commands() {
        assert_eq!(attach_command("demo"), CommandSpec::new("rmux", ["attach-session", "-t", "demo"]));
        assert_eq!(list_command(), CommandSpec::new("rmux", ["list-sessions", "-F", "#{session_name}"]));
        assert_eq!(kill_command("demo"), CommandSpec::new("rmux", ["kill-session", "-t", "demo"]));
        assert_eq!(snap_command("demo"), CommandSpec::new("rmux", ["capture-pane", "-p", "-e", "-t", "demo"]));
        assert_eq!(
            send_command("demo", "/mcp", true),
            CommandSpec::new("rmux", ["send-keys", "-t", "demo", "/mcp", "Enter"])
        );
        assert_eq!(
            send_command("demo", "hello", false),
            CommandSpec::new("rmux", ["send-keys", "-t", "demo", "hello"])
        );
    }

    #[test]
    fn strips_ansi_from_snapshots() {
        assert_eq!(strip_ansi("\u{1b}[31m# Red\u{1b}[0m\n"), "# Red\n");
    }
}
