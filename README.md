# Stained Glass

Stained Glass is a Tauri v2 desktop app for wrapping an interactive Claude session in a split-pane native GUI: live terminal on the left, rendered markdown preview on the right.

The MVP contains a Rust/Tauri backend scaffold, rmux session lifecycle helpers, PTY/event wiring, pane snapshot extraction, a static split-pane frontend, and the `stain` CLI workspace crate for shell-level session control.

## Repository layout

```text
stained-glass/
├── Cargo.toml                  # Cargo workspace root
├── package.json                # npm scripts for scaffold and CLI shape checks
├── scripts/
│   ├── check-scaffold.mjs      # verifies frontend/Tauri scaffold files/config
│   └── check-stain-cli.mjs     # verifies the CLI crate shape without Cargo
├── stain/                      # CLI companion binary crate
│   ├── Cargo.toml
│   └── src/main.rs             # `stain` open/attach/list/kill/snap
├── src-tauri/
│   ├── Cargo.toml              # Tauri app crate
│   ├── tauri.conf.json         # Tauri v2 configuration
│   ├── build.rs
│   └── src/
│       ├── main.rs
│       ├── session.rs
│       ├── pty.rs
│       ├── snapshot.rs
│       └── ipc.rs
└── src/                        # framework-free static frontend shell
    ├── index.html
    ├── style.css
    ├── ipc.js
    ├── terminal.js
    ├── preview.js
    └── vendor/                 # static MVP adapters for terminal/markdown/highlight APIs
```

## Required tools

Install these before running the full app locally:

- Rust toolchain with Cargo. Dependency validation in #4 found Rust `1.88+` is the safer effective baseline for current Tauri v2 transitive dependencies.
- Node.js `18+` and npm.
- `rmux` on `PATH` for session lifecycle, attach, list, kill, and snapshot commands.
- `claude` on `PATH` for the default session command.
- Tauri system dependencies for your OS:
  - Linux: WebKitGTK and related packages from the [Tauri Linux prerequisites](https://tauri.app/start/prerequisites/#linux).
  - macOS: Xcode Command Line Tools.

Useful prerequisite probes:

```bash
node --version
npm --version
rustc --version
cargo --version
command -v rmux
command -v claude
```

## Setup

```bash
git clone https://github.com/zpyoung/stained-glass.git
cd stained-glass
npm install
```

If you only need the lightweight static checks, `npm install` is not currently required because the check scripts use Node's standard library.

## Development commands

Lightweight checks that do not require Rust, Cargo, Tauri system dependencies, `rmux`, or `claude`:

```bash
npm run check:scaffold
npm run check:stain
node --check scripts/check-scaffold.mjs
node --check scripts/check-stain-cli.mjs
node --check src/ipc.js
node --check src/terminal.js
node --check src/preview.js
node --check src/vendor/xterm.js
node --check src/vendor/marked.js
node --check src/vendor/highlight.js
python3 -m json.tool src-tauri/tauri.conf.json >/dev/null
```

With Rust/Cargo available:

```bash
cargo test --workspace
cargo build --workspace
cargo build --release -p stain
```

With Tauri prerequisites available:

```bash
npm run tauri:dev
npm run tauri:build
```

Equivalent Cargo/Tauri commands, if `cargo-tauri` is installed directly instead of using the npm CLI, are:

```bash
cargo tauri dev
cargo tauri build
```

## Smoke tests

Run these after building in an environment with `rmux` and `claude` installed.

CLI session smoke:

```bash
cargo build --release -p stain
./target/release/stain --help
./target/release/stain open --session stained-glass-smoke --cmd claude --cwd "$PWD" --no-gui
./target/release/stain list
./target/release/stain snap --session stained-glass-smoke
./target/release/stain kill --session stained-glass-smoke
```

Expected results:

- `stain --help` lists `open`, `attach`, `list`, `kill`, and `snap`.
- `open --no-gui` creates or reuses the rmux session and exits `0`.
- `list` includes the smoke session while it is alive.
- `snap` prints a plain-text pane snapshot and does not include ANSI escape codes.
- `kill` exits `0`, and the session disappears from `list`.

GUI smoke:

```bash
npm run tauri:dev
```

Then verify:

- The app opens at or above the configured `800x500` minimum window size.
- The terminal pane renders raw `pty-data` on the left.
- Typing in the terminal sends input through `send_input`.
- The preview pane updates from `pane-snapshot` events.
- Preview HTML is rendered from escaped markdown, not raw untrusted HTML.
- Toolbar controls for split/preview/auto-scroll/theme remain usable at minimum size.

If automatic GUI launch from `stain open` is being tested:

```bash
STAINED_GLASS_APP=/path/to/stained-glass ./target/release/stain open --session stained-glass-smoke
```

Platform defaults:

- macOS: `stain open` uses `open -a "Stained Glass"`.
- Linux: `stain open` first tries `gtk-launch stained-glass`, then falls back to `xdg-open stained-glass://open`.
- Any platform: `STAINED_GLASS_APP=/path/to/launcher` overrides automatic GUI launch; `--no-gui` only ensures the rmux session exists.

## Data flow

Keystrokes:

```text
user keystroke
  → src/terminal.js Terminal.onData()
  → src/ipc.js sendInput(data)
  → Tauri invoke('send_input')
  → src-tauri/src/ipc.rs send_input()
  → PTY input channel
  → rmux attach-session PTY stdin
  → claude
```

Terminal output:

```text
claude output
  → rmux session PTY stdout
  → src-tauri/src/pty.rs read loop
  → Tauri emit('pty-data')
  → src/ipc.js onPtyData()
  → src/terminal.js Terminal.write()
  → terminal pane
```

Preview snapshots:

```text
rmux pane buffer
  → rmux capture-pane -p -e -t <session>
  → src-tauri/src/snapshot.rs strip ANSI
  → markdown-oriented extraction
  → Tauri emit('pane-snapshot')
  → src/ipc.js onPaneSnapshot()
  → src/preview.js marked/highlight-compatible render
  → preview pane
```

CLI control:

```text
stain open/list/kill/snap/attach
  → std::process::Command argv arrays
  → rmux CLI
  → session lifecycle or plain-text snapshot output
```

## `stain` CLI

`stain` controls Stained Glass rmux sessions independently of whether the GUI is open:

```bash
stain --help
stain open --session claude --cmd claude --cwd "$PWD"
stain open --session claude --no-gui
stain attach --session claude
stain list
stain snap --session claude
stain kill --session claude
```

Command behavior:

- `open`: creates the named rmux session when missing, using `--cmd` and `--cwd`, then attempts to launch the GUI unless `--no-gui` is set.
- `attach`: attaches the current terminal directly to `rmux attach-session -t <session>`.
- `list`: prints active rmux session names.
- `snap`: prints an ANSI-stripped plain-text `rmux capture-pane` snapshot.
- `kill`: stops the named rmux session.

CLI failures print actionable errors to stderr and return a non-zero exit code.

## Packaging commands

Build local artifacts:

```bash
npm run tauri:build
cargo build --release -p stain
```

Expected local outputs depend on platform and Tauri configuration. Common paths include:

- Tauri app bundles/installers under `src-tauri/target/release/bundle/`
- `stain` binary at `target/release/stain`

Do not treat a local package build as a release. Signing, notarization, uploading packages, creating GitHub releases, publishing installers, or changing production distribution settings require Zach's explicit approval.

## PR verification checklist

For any PR, include the exact commands you ran and call out missing local prerequisites clearly.

Backend / Rust changes:

- [ ] `cargo test --workspace`
- [ ] `cargo build --workspace`
- [ ] Relevant unit tests cover command construction or state transitions.
- [ ] If `rmux` behavior changed, run or document a live `rmux` smoke test.

Frontend changes:

- [ ] `npm run check:scaffold`
- [ ] `node --check src/ipc.js`
- [ ] `node --check src/terminal.js`
- [ ] `node --check src/preview.js`
- [ ] Browser/Tauri smoke for terminal rendering, input, preview updates, and minimum-size usability when a GUI environment is available.

CLI changes:

- [ ] `npm run check:stain`
- [ ] `cargo test -p stain`
- [ ] `cargo build --release -p stain`
- [ ] `stain --help` lists all MVP commands.
- [ ] `stain snap --session <name>` returns plain text in a live rmux environment.
- [ ] Failure paths return non-zero exit codes with actionable stderr.

Packaging changes:

- [ ] `npm run tauri:build`
- [ ] `cargo build --release -p stain`
- [ ] Artifact paths are documented.
- [ ] Release/signing/publishing steps are not performed without Zach's explicit approval.

Security / quality:

- [ ] No secrets, local credentials, profile paths, or machine-specific maintainer notes are committed.
- [ ] Run the repository security scanner if available, e.g. `/opt/data/bin/tirith scan .`.
