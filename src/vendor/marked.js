// Small, safe markdown renderer for the static MVP.
// It intentionally exports a marked-like API (`marked.parse`) so replacing it with
// upstream marked.js later is a one-line import change.

const INLINE_CODE = /`([^`]+)`/g;
const STRONG = /\*\*([^*]+)\*\*/g;
const EMPHASIS = /(?<!\*)\*([^*]+)\*(?!\*)/g;
const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export const marked = {
  parse(markdown = '') {
    const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let inCode = false;
    let codeBuffer = [];
    let inList = false;
    let inBlockquote = false;
    let tableBuffer = [];

    const closeList = () => {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
    };
    const closeBlockquote = () => {
      if (inBlockquote) {
        html.push('</blockquote>');
        inBlockquote = false;
      }
    };
    const flushTable = () => {
      if (tableBuffer.length === 0) return;
      html.push(renderTable(tableBuffer));
      tableBuffer = [];
    };
    const closeFlow = () => {
      closeList();
      closeBlockquote();
      flushTable();
    };

    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        if (inCode) {
          html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
          codeBuffer = [];
          inCode = false;
        } else {
          closeFlow();
          inCode = true;
        }
        continue;
      }

      if (inCode) {
        codeBuffer.push(line);
        continue;
      }

      if (isTableLine(line)) {
        closeList();
        closeBlockquote();
        tableBuffer.push(line);
        continue;
      }
      flushTable();

      const trimmed = line.trim();
      if (!trimmed) {
        closeFlow();
        continue;
      }

      const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (heading) {
        closeFlow();
        const level = heading[1].length;
        html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        continue;
      }

      const list = /^[-*+]\s+(.+)$/.exec(trimmed);
      if (list) {
        closeBlockquote();
        if (!inList) {
          html.push('<ul>');
          inList = true;
        }
        html.push(`<li>${renderInline(list[1])}</li>`);
        continue;
      }

      const quote = /^>\s?(.*)$/.exec(trimmed);
      if (quote) {
        closeList();
        if (!inBlockquote) {
          html.push('<blockquote>');
          inBlockquote = true;
        }
        html.push(`<p>${renderInline(quote[1])}</p>`);
        continue;
      }

      closeFlow();
      html.push(`<p>${renderInline(trimmed)}</p>`);
    }

    if (inCode) {
      html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
    }
    closeFlow();
    return html.join('\n');
  }
};

function renderInline(value) {
  return escapeHtml(value)
    .replace(LINK, '<a href="$2" rel="noreferrer" target="_blank">$1</a>')
    .replace(INLINE_CODE, '<code>$1</code>')
    .replace(STRONG, '<strong>$1</strong>')
    .replace(EMPHASIS, '<em>$1</em>');
}

function isTableLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|');
}

function renderTable(lines) {
  const rows = lines
    .filter((line) => !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim()))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));

  if (rows.length === 0) {
    return '';
  }

  const [head, ...body] = rows;
  const header = `<thead><tr>${head.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>`;
  const rowsHtml = body.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('');
  return `<table>${header}<tbody>${rowsHtml}</tbody></table>`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
