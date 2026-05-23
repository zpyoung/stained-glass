const tauriCore = globalThis.__TAURI__?.core;
const tauriEvent = globalThis.__TAURI__?.event;

function requireTauriApi(api, name) {
  if (!api) {
    throw new Error(`Tauri ${name} API is unavailable. Run inside the Tauri webview.`);
  }
  return api;
}

export async function startSession({ session = 'claude', cmd = 'claude', cwd = '.' } = {}) {
  const { invoke } = requireTauriApi(tauriCore, 'core');
  return invoke('start_session', { sessionName: session, cmd, cwd });
}

export async function sendInput(data) {
  const { invoke } = requireTauriApi(tauriCore, 'core');
  return invoke('send_input', { data });
}

export async function resizePty(cols, rows) {
  const { invoke } = requireTauriApi(tauriCore, 'core');
  return invoke('resize_pty', { cols, rows });
}

export async function killSession() {
  const { invoke } = requireTauriApi(tauriCore, 'core');
  return invoke('kill_session');
}

export function onPtyData(handler) {
  const { listen } = requireTauriApi(tauriEvent, 'event');
  return listen('pty-data', (event) => handler(event.payload));
}

export function onPaneSnapshot(handler) {
  const { listen } = requireTauriApi(tauriEvent, 'event');
  return listen('pane-snapshot', (event) => handler(event.payload));
}
