import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const requiredFiles = [
  'Cargo.toml',
  'stain/Cargo.toml',
  'stain/src/main.rs'
];

for (const file of requiredFiles) {
  await access(join(root, file));
}

const workspace = await readFile(join(root, 'Cargo.toml'), 'utf8');
for (const expected of ['members = ["src-tauri", "stain"]', 'resolver = "2"']) {
  if (!workspace.includes(expected)) {
    throw new Error(`Cargo workspace is missing ${expected}`);
  }
}

const manifest = await readFile(join(root, 'stain/Cargo.toml'), 'utf8');
for (const expected of ['name = "stain"', 'clap = { version = "4", features = ["derive"] }', 'anyhow = "1"']) {
  if (!manifest.includes(expected)) {
    throw new Error(`stain/Cargo.toml is missing ${expected}`);
  }
}

const main = await readFile(join(root, 'stain/src/main.rs'), 'utf8');
for (const expected of [
  'enum Commands',
  'Open(OpenArgs)',
  'Attach(SessionArgs)',
  'List',
  'Kill(SessionArgs)',
  'Snap(SessionArgs)',
  'capture-pane',
  'list-sessions',
  'kill-session',
  'attach-session',
  'new-session',
  'std::process::exit(1)',
  'STAINED_GLASS_APP',
  'target_os = "macos"',
  'target_os = "linux"'
]) {
  if (!main.includes(expected)) {
    throw new Error(`stain/src/main.rs is missing ${expected}`);
  }
}

console.log('Stain CLI check passed (workspace, manifest, commands, and GUI launch notes verified).');
