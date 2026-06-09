import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { marked } from '../src/vendor/marked.js';

const root = new URL('..', import.meta.url).pathname;
const requiredFiles = [
  'Cargo.toml',
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
  'src-tauri/icons/icon.png',
  'src-tauri/build.rs',
  'src-tauri/src/main.rs',
  'scripts/check-claude-bridge.mjs',
  'bridge/claude/schema.mjs',
  'bridge/claude/channel-server.mjs',
  'bridge/claude/harness.mjs',
  'bridge/claude/hook-normalizer.mjs',
  'docs/spikes/0002-claude-code-bridge.md',
  'src/index.html',
  'src/style.css',
  'src/ipc.js',
  'src/terminal.js',
  'src/preview.js',
  'src/vendor/xterm.js',
  'src/vendor/marked.js',
  'src/vendor/highlight.js',
  'README.md'
];

for (const file of requiredFiles) {
  await access(join(root, file));
}

const tauriConfig = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
if (tauriConfig.productName !== 'Stained Glass') {
  throw new Error('tauri.conf.json productName must be Stained Glass');
}
if (tauriConfig.build?.frontendDist !== '../src') {
  throw new Error('tauri.conf.json must point frontendDist at ../src');
}

const index = await readFile(join(root, 'src/index.html'), 'utf8');
for (const id of ['terminal', 'preview', 'status', 'preview-toggle', 'autoscroll-toggle', 'split-toggle']) {
  if (!index.includes(`id="${id}"`)) {
    throw new Error(`src/index.html is missing #${id}`);
  }
}

const terminal = await readFile(join(root, 'src/terminal.js'), 'utf8');
for (const expected of ['onPtyData', 'sendInput', 'resizePty', 'Terminal']) {
  if (!terminal.includes(expected)) {
    throw new Error(`src/terminal.js must configure ${expected}`);
  }
}

const preview = await readFile(join(root, 'src/preview.js'), 'utf8');
for (const expected of ['onPaneSnapshot', 'marked', 'hljs', 'innerHTML']) {
  if (!preview.includes(expected)) {
    throw new Error(`src/preview.js must configure ${expected}`);
  }
}

const rendered = marked.parse('# Hello\n\n<script>alert(1)</script>\n\n- **safe** item');
assert.match(rendered, /<h1>Hello<\/h1>/);
assert.match(rendered, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.match(rendered, /<strong>safe<\/strong>/);

const claudeBridge = await readFile(join(root, 'bridge/claude/channel-server.mjs'), 'utf8');
for (const expected of [
  "'claude/channel'",
  "'claude/channel/permission'",
  'notifications/claude/channel',
  'stained_glass_reply',
  'stained_glass_status',
  'stained_glass_artifact'
]) {
  if (!claudeBridge.includes(expected)) {
    throw new Error(`bridge/claude/channel-server.mjs must declare ${expected}`);
  }
}

const spikeDoc = await readFile(join(root, 'docs/spikes/0002-claude-code-bridge.md'), 'utf8');
for (const expected of [
  'Claude Code v2.1.80+',
  '--dangerously-load-development-channels',
  'session launching/supervision',
  'durable recovery',
  'permission UX',
  'frontend polish'
]) {
  if (!spikeDoc.includes(expected)) {
    throw new Error(`docs/spikes/0002-claude-code-bridge.md must document ${expected}`);
  }
}

console.log(`Scaffold check passed (${requiredFiles.length} files verified).`);
