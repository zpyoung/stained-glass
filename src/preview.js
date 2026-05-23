import { onPaneSnapshot } from './ipc.js';
import { marked } from './vendor/marked.js';
import { hljs } from './vendor/highlight.js';

const previewElement = document.querySelector('#preview');
const previewPane = document.querySelector('#preview-pane');
const previewToggle = document.querySelector('#preview-toggle');
const previewStateElement = document.querySelector('#preview-state');
const workspace = document.querySelector('#workspace');

let autoScroll = true;

function setPreviewState(message) {
  if (previewStateElement) {
    previewStateElement.textContent = message;
  }
}

export function renderMarkdown(markdown) {
  const html = marked.parse(markdown || '*No markdown content in the latest pane snapshot.*');
  return html.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_match, code) => {
    const highlighted = hljs.highlightAuto(decodeHtml(code));
    return `<pre><code class="language-${highlighted.language}">${highlighted.value}</code></pre>`;
  });
}

function setPreviewMarkdown(markdown) {
  if (!previewElement) {
    return;
  }

  previewElement.innerHTML = renderMarkdown(markdown);
  if (autoScroll) {
    previewElement.scrollTop = previewElement.scrollHeight;
  }
  setPreviewState(markdown ? 'live snapshot' : 'empty snapshot');
}

function configurePreviewControls() {
  previewToggle?.addEventListener('click', () => {
    const hidden = previewPane?.classList.contains('is-hidden');
    if (hidden) {
      previewPane?.classList.remove('is-hidden');
      if (workspace) workspace.dataset.preview = 'visible';
      previewToggle.setAttribute('aria-pressed', 'true');
    } else {
      previewPane?.classList.add('is-hidden');
      if (workspace) workspace.dataset.preview = 'terminal-only';
      previewToggle.setAttribute('aria-pressed', 'false');
    }
  });

  previewElement?.addEventListener('scroll', () => {
    const distanceFromBottom = previewElement.scrollHeight - previewElement.clientHeight - previewElement.scrollTop;
    autoScroll = distanceFromBottom < 16;
  });
}

async function bootPreview() {
  if (!previewElement) {
    return;
  }

  configurePreviewControls();

  if (!globalThis.__TAURI__) {
    setPreviewMarkdown(`# Markdown preview\n\nOpen Stained Glass in Tauri to render live \`pane-snapshot\` events.\n\n- Terminal output stays on the left.\n- Extracted markdown updates here.\n- HTML is escaped before rendering.`);
    setPreviewState('scaffold mode');
    return;
  }

  await onPaneSnapshot((payload) => {
    const markdown = typeof payload === 'string' ? payload : payload?.markdown;
    setPreviewMarkdown(markdown || '');
  });
}

function decodeHtml(value) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

bootPreview().catch((error) => {
  setPreviewMarkdown(`Preview will connect when pane snapshots are available.\n\n\`${error.message}\``);
  setPreviewState('backend error');
});
