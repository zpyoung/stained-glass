import { Terminal } from './vendor/xterm.js';
import { onPtyData, resizePty, sendInput, startSession } from './ipc.js';

const terminalElement = document.querySelector('#terminal');
const statusElement = document.querySelector('#status');
const terminalStateElement = document.querySelector('#terminal-state');
const autoScrollToggle = document.querySelector('#autoscroll-toggle');
const themeToggle = document.querySelector('#theme-toggle');
const workspace = document.querySelector('#workspace');
const splitToggle = document.querySelector('#split-toggle');

let autoScroll = true;
let terminal;

function setStatus(message) {
  if (statusElement) {
    statusElement.textContent = message;
  }
}

function setTerminalState(message) {
  if (terminalStateElement) {
    terminalStateElement.textContent = message;
  }
}

function estimateTerminalSize() {
  const rect = terminalElement?.getBoundingClientRect();
  const cols = Math.max(40, Math.floor((rect?.width ?? 960) / 8));
  const rows = Math.max(12, Math.floor((rect?.height ?? 480) / 17));
  return { cols, rows };
}

function scrollTerminalToBottom() {
  const screen = terminalElement?.querySelector('.xterm-screen');
  if (screen && autoScroll) {
    screen.scrollTop = screen.scrollHeight;
  }
}

function configureControls() {
  autoScrollToggle?.addEventListener('click', () => {
    autoScroll = !autoScroll;
    autoScrollToggle.setAttribute('aria-pressed', String(autoScroll));
    autoScrollToggle.textContent = autoScroll ? 'Auto-scroll' : 'Manual scroll';
    scrollTerminalToBottom();
  });

  themeToggle?.addEventListener('click', () => {
    const dim = document.body.classList.toggle('dim-theme');
    themeToggle.setAttribute('aria-pressed', String(dim));
  });

  splitToggle?.addEventListener('click', () => {
    const split = workspace?.dataset.preview !== 'terminal-only';
    if (workspace) {
      workspace.dataset.preview = split ? 'terminal-only' : 'visible';
    }
    splitToggle.setAttribute('aria-pressed', String(!split));
  });
}

async function bootTerminal() {
  if (!terminalElement) {
    return;
  }

  terminal = new Terminal({
    convertEol: true,
    cursorBlink: true,
    fontSize: 13,
    theme: {
      background: '#101217',
      foreground: '#edf1f7'
    }
  });
  terminal.open(terminalElement);
  terminal.write('Stained Glass terminal ready.\n');
  configureControls();

  terminal.onData((data) => {
    sendInput(data).catch((error) => setStatus(`input error · ${error.message}`));
  });

  if (!globalThis.__TAURI__) {
    terminal.write('Open with Tauri to start the rmux/PTY backend.\n');
    setTerminalState('scaffold mode');
    setStatus('● scaffold · open with Tauri to enable IPC');
    return;
  }

  await onPtyData((data) => {
    terminal.write(data);
    scrollTerminalToBottom();
  });

  const resize = () => {
    const { cols, rows } = estimateTerminalSize();
    resizePty(cols, rows).catch((error) => setStatus(`resize error · ${error.message}`));
  };
  window.addEventListener('resize', resize);

  const { cols, rows } = estimateTerminalSize();
  await startSession({ session: 'claude', cmd: 'claude', cwd: '.' });
  await resizePty(cols, rows).catch((error) => setStatus(`resize warning · ${error.message}`));
  setTerminalState(`${cols}×${rows}`);
  setStatus('● connected · Tauri IPC');
}

bootTerminal().catch((error) => {
  setTerminalState('backend error');
  setStatus(`● backend pending · ${error.message}`);
});
