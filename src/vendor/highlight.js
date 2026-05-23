import { escapeHtml } from './marked.js';

// Minimal highlight.js-shaped adapter. It escapes code and returns a class/value
// pair compatible with the subset the preview renderer needs.
export const hljs = {
  highlightAuto(code = '') {
    return {
      language: 'text',
      relevance: 0,
      value: escapeHtml(code)
    };
  }
};
