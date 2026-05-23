import { onPtyData, resizePty, sendInput, startSession } from './ipc.js';

const terminalElement = document.querySelector('#terminal');
const statusElement = document.querySelector('#status');

function setStatus(message) {
  if (statusElement) {
    statusElement.textContent = message;
  }
}

async function bootTerminal() {
  if (!terminalElement) {
    return;
  }

  terminalElement.textContent = 'Terminal backend pending. Issue #7 will add PTY streaming.';

  if (!globalThis.__TAURI__) {
    setStatus('● scaffold · open with Tauri to enable IPC');
    return;
  }

  await onPtyData((data) => {
    terminalElement.textContent += data;
    terminalElement.scrollTop = terminalElement.scrollHeight;
  });

  window.addEventListener('keydown', (event) => {
    if (event.key.length === 1) {
      sendInput(event.key).catch((error) => setStatus(`input error · ${error.message}`));
    }
  });

  window.addEventListener('resize', () => {
    resizePty(120, 36).catch((error) => setStatus(`resize error · ${error.message}`));
  });

  await startSession({ session: 'claude', cmd: 'claude', cwd: '.' });
  setStatus('● connected · Tauri IPC');
}

bootTerminal().catch((error) => {
  setStatus(`● backend pending · ${error.message}`);
});
