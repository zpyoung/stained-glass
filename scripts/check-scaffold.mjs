import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const requiredFiles = [
  'Cargo.toml',
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
  'src-tauri/build.rs',
  'src-tauri/src/main.rs',
  'src/index.html',
  'src/style.css',
  'src/ipc.js',
  'src/terminal.js',
  'src/preview.js',
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
for (const id of ['terminal', 'preview', 'status']) {
  if (!index.includes(`id="${id}"`)) {
    throw new Error(`src/index.html is missing #${id}`);
  }
}

console.log(`Scaffold check passed (${requiredFiles.length} files verified).`);
