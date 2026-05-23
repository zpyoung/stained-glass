# Stained Glass

Stained Glass is a Tauri v2 desktop app for wrapping an interactive Claude session in a split-pane native GUI: live terminal on the left, rendered markdown preview on the right.

The MVP now has a Rust/Tauri backend scaffold, rmux session lifecycle helpers, PTY/event wiring, pane snapshot extraction, a static split-pane frontend, and the `stain` CLI workspace crate for shell-level session control.

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

## Prerequisites

Install these before running the Tauri app locally:

- Rust toolchain with Cargo. Dependency validation in #4 found Rust `1.88+` is the safer effective baseline for current Tauri v2 transitive dependencies.
- Node.js `18+` (this environment verified Node `20.19.2`).
- `rmux` on `PATH` for session lifecycle, attach, list, kill, and snapshot commands.
- `claude` on `PATH` for the default session command.
- Tauri system dependencies for your OS:
  - Linux: WebKitGTK and related packages from the [Tauri Linux prerequisites](https://tauri.app/start/prerequisites/#linux).
  - macOS: Xcode Command Line Tools.

## Local verification

The lightweight checks can run without a Rust toolchain:

```bash
npm run check:scaffold
npm run check:stain
```

Expected results:

```text
Scaffold check passed (14 files verified).
Stain CLI check passed (workspace, manifest, commands, and GUI launch notes verified).
```

With Rust, Cargo, and Tauri prerequisites installed, run:

```bash
npm install
npm run tauri:dev
npm run tauri:build
cargo test --workspace
cargo build --release -p stain
```

Equivalent Cargo/Tauri commands, if `cargo-tauri` is installed directly instead of using the npm CLI, are:

```bash
cargo tauri dev
cargo tauri build
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

GUI launch behavior is platform-specific:

- macOS: `stain open` uses `open -a "Stained Glass"`.
- Linux: `stain open` first tries `gtk-launch stained-glass`, then falls back to `xdg-open stained-glass://open`.
- Any platform: set `STAINED_GLASS_APP=/path/to/launcher` to override automatic GUI launch, or use `--no-gui` to only ensure the rmux session exists.

CLI failures print actionable errors to stderr and return a non-zero exit code.
