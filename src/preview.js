import { onPaneSnapshot } from './ipc.js';

const previewElement = document.querySelector('#preview');

function setPreviewText(markdown) {
  if (!previewElement) {
    return;
  }
  previewElement.textContent = markdown;
  previewElement.scrollTop = previewElement.scrollHeight;
}

async function bootPreview() {
  if (!previewElement) {
    return;
  }

  if (!globalThis.__TAURI__) {
    setPreviewText('Preview backend pending. Issue #10 will add markdown rendering.');
    return;
  }

  await onPaneSnapshot((markdown) => {
    setPreviewText(markdown || '');
  });
}

bootPreview().catch((error) => {
  setPreviewText(`Preview will connect when pane snapshots are available. ${error.message}`);
});
