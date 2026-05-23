// Minimal xterm-compatible adapter for the static Stained Glass MVP.
// The public surface intentionally mirrors the subset of xterm.js used by the app
// so the implementation can be swapped for the upstream package once a bundler or
// vendored distribution is added.

const CONTROL_SEQUENCES = /\x1b\[[0-?]*[ -/]*[@-~]/g;

export class Terminal {
  constructor(options = {}) {
    this.options = {
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      theme: {},
      ...options
    };
    this._buffer = '';
    this._dataHandlers = new Set();
    this._element = null;
    this._screen = null;
    this._input = null;
  }

  open(element) {
    this._element = element;
    element.classList.add('xterm-host');
    element.innerHTML = '';

    const screen = document.createElement('pre');
    screen.className = 'xterm-screen';
    screen.setAttribute('aria-live', 'polite');
    screen.style.fontFamily = this.options.fontFamily;
    screen.style.fontSize = `${this.options.fontSize}px`;

    const input = document.createElement('textarea');
    input.className = 'xterm-input';
    input.setAttribute('aria-label', 'Terminal input');
    input.autocapitalize = 'off';
    input.autocomplete = 'off';
    input.autocorrect = 'off';
    input.spellcheck = false;

    input.addEventListener('keydown', (event) => {
      const sequence = keyEventToSequence(event);
      if (sequence === null) {
        return;
      }
      event.preventDefault();
      this._emitData(sequence);
    });

    element.addEventListener('pointerdown', () => input.focus());
    element.append(screen, input);
    this._screen = screen;
    this._input = input;
    this._render();
    this.focus();
  }

  focus() {
    this._input?.focus();
  }

  onData(handler) {
    this._dataHandlers.add(handler);
    return { dispose: () => this._dataHandlers.delete(handler) };
  }

  write(data) {
    this._buffer += String(data ?? '').replace(CONTROL_SEQUENCES, '');
    if (this.options.convertEol) {
      this._buffer = this._buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }
    this._render();
  }

  clear() {
    this._buffer = '';
    this._render();
  }

  dispose() {
    this._dataHandlers.clear();
    if (this._element) {
      this._element.innerHTML = '';
    }
  }

  _emitData(data) {
    for (const handler of this._dataHandlers) {
      handler(data);
    }
  }

  _render() {
    if (!this._screen) {
      return;
    }
    this._screen.textContent = this._buffer || 'Waiting for terminal output…';
    this._screen.scrollTop = this._screen.scrollHeight;
  }
}

function keyEventToSequence(event) {
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
    return event.key;
  }

  if (event.key === 'Enter') return '\r';
  if (event.key === 'Backspace') return '\x7f';
  if (event.key === 'Tab') return '\t';
  if (event.key === 'Escape') return '\x1b';
  if (event.key === 'ArrowUp') return '\x1b[A';
  if (event.key === 'ArrowDown') return '\x1b[B';
  if (event.key === 'ArrowRight') return '\x1b[C';
  if (event.key === 'ArrowLeft') return '\x1b[D';
  if (event.ctrlKey && event.key.length === 1) {
    const code = event.key.toUpperCase().charCodeAt(0) - 64;
    if (code > 0 && code < 32) {
      return String.fromCharCode(code);
    }
  }
  return null;
}
