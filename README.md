# Stained Glass

Stained Glass is a planned Tauri v2 desktop app for wrapping an interactive Claude session in a split-pane native GUI: live terminal on the left, rendered markdown preview on the right.

This repository is currently at the scaffold stage. The Rust backend and frontend shell exist so future issue-tracked work can add rmux session lifecycle, PTY streaming, pane snapshots, IPC commands, and the `stain` CLI in focused PRs.

## Repository layout

```text
stained-glass/
├── Cargo.toml                  # Cargo workspace root
├── package.json                # npm scripts for scaffold checks and Tauri commands
├── scripts/
│   └── check-scaffold.mjs      # verifies the expected scaffold files/config
├── src-tauri/
│   ├── Cargo.toml              # Tauri app crate
│   ├── tauri.conf.json         # Tauri v2 configuration
│   ├── build.rs
│   └── src/
│       └── main.rs             # minimal Tauri entrypoint
└── src/                        # framework-free static frontend shell
    ├── index.html
    ├── style.css
    ├── ipc.js
    ├── terminal.js
    └── preview.js
```

The eventual `stain/` CLI crate is intentionally not added yet; it is tracked separately in #11.

## Prerequisites

Install these before running the Tauri app locally:

- Rust toolchain with Cargo. Dependency validation in #4 found Rust `1.88+` is the safer effective baseline for current Tauri v2 transitive dependencies.
- Node.js `18+` (this environment verified Node `20.19.2`).
- Tauri system dependencies for your OS:
  - Linux: WebKitGTK and related packages from the [Tauri Linux prerequisites](https://tauri.app/start/prerequisites/#linux).
  - macOS: Xcode Command Line Tools.
- Later runtime work will also require `rmux` and `claude` on `PATH`; those are not needed for this scaffold check.

## Local verification

The scaffold can be checked without a Rust toolchain:

```bash
npm run check:scaffold
```

Expected result:

```text
Scaffold check passed (11 files verified).
```

With Rust, Cargo, and Tauri prerequisites installed, the basic Tauri commands are:

```bash
npm install
npm run tauri:dev
npm run tauri:build
```

Equivalent Cargo commands, if `cargo-tauri` is installed directly instead of using the npm CLI, are:

```bash
cargo tauri dev
cargo tauri build
```

The current frontend shell will render the split-pane layout. Backend IPC commands such as `start_session`, `send_input`, `resize_pty`, and `kill_session` are intentionally left for the follow-up IPC/backend issues.
