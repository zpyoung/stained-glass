# Spike: dependency and command validation for Stained Glass MVP

Issue: [#4](https://github.com/zpyoung/stained-glass/issues/4)

Source spec: [Discussion #2](https://github.com/zpyoung/stained-glass/discussions/2)

## Goal

Validate the highest-risk assumptions in the initial Rust/Tauri spec before the first implementation PR copies sample code into the repository.

## Findings

Version claims below are **observed during this spike on 2026-05-23 UTC**. Re-check them before changing dependency versions.

### Tauri v2 setup path

**Decision:** keep the spec's Tauri v2 + static frontend direction.

Confirmed facts:

- The current Tauri 2 crate is `tauri` `2.11.2` and advertises Rust `1.77.2` as its crate-level minimum.
- `tauri-build` is the paired build-time crate; current version observed during the spike is `2.6.2`.
- Tauri supports framework-free/static frontends. The Tauri frontend guide describes Tauri as a static web host for a folder containing HTML, CSS, JavaScript, and related assets.
- `tauri.conf.json` supports the `build.frontendDist` and `build.devUrl` keys used by the spec.

Implementation implications:

- `src/` can remain vanilla HTML/CSS/JS for the MVP.
- A generated Tauri scaffold is still useful, but the implementation should keep the frontend dependency surface small unless a later issue justifies a bundler.
- The build docs must call out Rust/Tauri prerequisites because this local runner currently does **not** have `cargo`/`rustc` installed.
- If the MVP uses `rust-pty` `0.2.0`, the effective Rust toolchain requirement is **Rust 1.88+**, because that crate advertises `rust-version = "1.88"`. Tauri's lower MSRV is not sufficient for the full proposed dependency set.

### RMUX command semantics

**Decision:** keep `rmux` as the session multiplexer target, but treat it as an explicit prerequisite and document installation.

Confirmed facts:

- RMUX is a Rust terminal multiplexer with a tmux-compatible CLI and a typed Rust SDK.
- The public RMUX docs show these shell commands matching the spec's direction:
  - `rmux new-session -d -s demo`
  - `rmux attach-session -t demo`
  - `rmux capture-pane -p -t demo`
- The examples page lists the tmux-compatible commands used by the spec, including `has-session`, `new-session`, `attach-session`, `capture-pane`, `kill-session`, and `list-sessions`.
- RMUX install options include:
  - `curl -fsSL https://rmux.io/install.sh | sh`
  - `cargo install rmux --locked`
  - prebuilt GitHub release binaries/checksums

Security note: prefer release binaries with checksum verification or `cargo install rmux --locked` for reproducible installs. The upstream `curl ... | sh` command is convenient, but should only be used after reviewing/trusting the install script source.

Local environment result:

- `rmux` is **not** installed in this runner.
- `tmux` is also not installed in this runner.
- The implementation should therefore provide clear runtime errors for missing `rmux`, and tests should cover command construction separately from real process execution.

Implementation implications:

- The backend should shell out to the `rmux` CLI for MVP rather than adopting `rmux-sdk` immediately. The spec's backend code is already framed around CLI commands.
- Use `std::process::Command` or Tokio command APIs with argv arrays; do **not** build shell-interpolated command strings. Validate/sanitize user-controlled values such as session names before passing them to `rmux`.
- Keep `rmux-sdk` as a possible later enhancement if CLI scraping becomes too brittle.
- Add a small command-runner abstraction for testability: unit tests can verify arguments without needing `rmux` installed.

### PTY crate choice

**Decision:** keep `rust-pty` for the first implementation, but update the spec sample code to match the current crate API.

Confirmed facts from `rust-pty` `0.2.0` docs/API:

- The crate describes itself as a cross-platform async PTY library.
- `NativePtySystem` exists as a platform alias.
- `PtySystem` exposes an async `spawn(program, args, &PtyConfig)` method.
- `PtySystem` also provides `spawn_shell(&PtyConfig)`.
- `PtyMaster` implements `AsyncRead + AsyncWrite + Send + Sync + Unpin`.
- `PtyMaster` exposes `resize(WindowSize)` and `window_size()`.
- `PtyConfig` has fields/builders for window size, working directory, environment, new session, controlling terminal, and spawn timeout.

Spec correction:

The Discussion #2 snippet uses this shape:

```rust
let (mut master, _child) = NativePtySystem::spawn(&config, &cmd[0], &cmd[1..]).await?;
```

The current documented trait signature has the arguments in this order:

```rust
NativePtySystem::spawn(&cmd[0], &cmd[1..], &config).await?;
```

Implementation implications:

- Use the current documented order: `spawn(program, args, &config)`.
- Preserve the pty master inside the app state strongly enough to support later resize calls; do not split it in a way that makes `resize()` impossible.
- Add tests around command assembly and state transitions; true pty integration can be a smoke/manual test until CI has Rust and platform dependencies.

### Alternative PTY crates

Observed alternatives:

- `pty-process` `0.5.3`: mature download count, async APIs behind features, explicit resize support, child as `tokio::process::Child`.
- `portable-pty` `0.9.0`: mature and cross-platform, backed by the WezTerm project, but not tokio-native in the same direct way.

Recommendation:

- Start with `rust-pty` because it best matches the spec's tokio-native shape and exposes resize on the master.
- If `rust-pty` proves immature during implementation, fall back to `pty-process` before widening the frontend/backend design.

## Required deviations from Discussion #2

1. **Fix the `rust-pty` spawn call order** from `spawn(&config, program, args)` to `spawn(program, args, &config)`.
2. **Treat missing local `rmux`/Rust toolchain as environment gaps**, not spec failures. The code should document prerequisites and fail clearly at runtime when external binaries are missing.
3. **Make resize support a first-class state concern**: store or wrap the pty master so `resize_pty` can call `PtyMaster::resize(WindowSize)` after the initial IPC wiring lands.

## Verification performed

Commands run in this spike environment:

```text
node --version                    # v20.19.2
npm --version                     # 9.2.0
rustc --version                   # command not found
cargo --version                   # command not found
command -v rmux                   # not found
command -v tmux                   # not found
```

External docs/API checks were performed against:

- crates.io API for `rust-pty`, `pty-process`, `portable-pty`, `tauri`, and `tauri-build`
- docs.rs pages for `rust-pty` 0.2.0 traits/config
- Tauri v2 frontend/config docs
- RMUX docs and GitHub README

Caveat: because this runner lacks `cargo`, `rustc`, and `rmux`, this spike validates `rust-pty` API compatibility and RMUX command behavior from public docs/API metadata only. The first implementation PR should still compile the selected Rust dependency set in an environment with Rust 1.88+ and smoke-test real `rmux` commands where available.

## Follow-up work

- [ ] #5 should bootstrap the workspace with versions consistent with these findings.
- [ ] #6 should isolate `rmux` command construction for tests.
- [ ] #7 should use the corrected `rust-pty` API and keep resize possible.
- [ ] #12 should document `rmux`, Rust, Node, and Tauri prerequisites clearly.
