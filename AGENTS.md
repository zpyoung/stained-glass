# Stained Glass Agent Instructions

This file contains repository-level guidance for AI agents and contributors working in this project. Keep it portable and public: repository-specific expectations belong here; maintainer-, profile-, credential-, or machine-specific instructions belong in ignored local files such as `AGENTS.local.md`.

## Project identity

- Product: Stained Glass
- Repository: `zpyoung/stained-glass`
- Default branch: `main`
- Purpose: Rust/Tauri desktop app that pairs a live terminal with a markdown preview workflow.

## Source of product direction

- Use GitHub issues, discussions, and repository documentation as the durable planning surfaces.
- Treat issues as executable work packets: read the goal, scope, comments, and acceptance criteria before changing code.
- Do not invent architecture or framework choices beyond the stated product direction without recording the rationale in the relevant issue or PR.

## Development expectations

- Keep changes focused and reviewable.
- Prefer small, explicit modules over hidden coupling.
- Add or update verification alongside code changes when practical.
- Update README or other docs when behavior, setup, commands, or assumptions change.
- Keep PR descriptions accurate: summary, verification, linked issue(s), and known limitations.

## Verification

Run the relevant checks for the files you changed. Current lightweight checks include:

- `test -f README.md`
- `npm run check:scaffold`
- `node --check scripts/check-scaffold.mjs`
- `node --check src/ipc.js`
- `node --check src/terminal.js`
- `node --check src/preview.js`
- `python3 -m json.tool src-tauri/tauri.conf.json >/dev/null`

If Rust/Cargo/Tauri tooling is available, also run the relevant Cargo/Tauri checks for Rust-side changes. If a check cannot be run in your environment, state that clearly in the PR and provide the best available substitute.

## Boundaries

- Do not commit secrets, credentials, local paths, or profile-specific automation details.
- Ask before releases, publishing, production/live settings, destructive operations, or irreversible public-impact changes.
- Keep local-only operational guidance in `AGENTS.local.md` or another ignored file, not in this tracked repository file.
