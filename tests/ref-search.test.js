// Tests for Ref search helpers — keep in sync with app.js.
import { describe, it, expect } from 'vitest';

function normalizeText(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildNormMap(label) {
  let normalized = '';
  const normToOrig = [];
  for (let i = 0; i < label.length; ) {
    const cp = label.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const n = normalizeText(ch);
    for (let j = 0; j < n.length; j++) {
      normalized += n[j];
      normToOrig.push(i);
    }
    i += ch.length;
  }
  return { normalized, normToOrig };
}

function highlightRefLabel(label, query) {
  const escapeHtml = str =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const raw = (query || '').trim();
  if (!raw) return escapeHtml(label);

  const q = normalizeText(raw);
  const { normalized, normToOrig } = buildNormMap(label);
  const idx = normalized.indexOf(q);
  if (idx === -1) return escapeHtml(label);

  const highlightOrig = new Set();
  for (let k = idx; k < idx + q.length; k++) {
    highlightOrig.add(normToOrig[k]);
  }

  let html = '';
  let open = false;
  for (let i = 0; i < label.length; ) {
    const cp = label.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const inHighlight = highlightOrig.has(i);
    if (inHighlight && !open) {
      html += '<span class="ref-match">';
      open = true;
    } else if (!inHighlight && open) {
      html += '</span>';
      open = false;
    }
    html += escapeHtml(ch);
    i += ch.length;
  }
  if (open) html += '</span>';
  return html;
}

describe('Ref search — highlightRefLabel', () => {
  const longLabel =
    '2026-COL-SOR-CR-Les arrières de La Rochelle - Levant cloturée10020021558845';

  it('highlights a contiguous substring match only', () => {
    expect(highlightRefLabel(longLabel, 'Les arri')).toBe(
      '2026-COL-SOR-CR-<span class="ref-match">Les arri</span>ères de La Rochelle - Levant cloturée10020021558845'
    );
  });

  it('does not scatter highlights across the label for partial multi-word queries', () => {
    const html = highlightRefLabel(longLabel, 'les avan');
    expect(html).not.toContain('<span class="ref-match">');
    expect(html).toBe(longLabel);
  });

  it('highlights accent-insensitive contiguous matches', () => {
    expect(highlightRefLabel('Café Central', 'cafe')).toBe(
      '<span class="ref-match">Café</span> Central'
    );
  });
});
