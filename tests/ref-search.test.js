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

function buildCollapsedMap(normalized) {
  let collapsed = '';
  const collapsedToNorm = [];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === ' ') continue;
    collapsed += normalized[i];
    collapsedToNorm.push(i);
  }
  return { collapsed, collapsedToNorm };
}

function findCollapsedRange(normalized, collapsedQuery) {
  if (!collapsedQuery) return null;
  const { collapsed, collapsedToNorm } = buildCollapsedMap(normalized);
  const idx = collapsed.indexOf(collapsedQuery);
  if (idx === -1) return null;
  return {
    start: collapsedToNorm[idx],
    end: collapsedToNorm[idx + collapsedQuery.length - 1]
  };
}

function findHighlightRange(label, rawQuery) {
  const tokens = normalizeText(rawQuery).split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  const { normalized, normToOrig } = buildNormMap(label);

  if (tokens.length === 1) {
    const token = tokens[0];
    const idx = normalized.indexOf(token);
    if (idx !== -1) {
      return { start: idx, end: idx + token.length - 1, normToOrig };
    }
    const collapsed = findCollapsedRange(normalized, token);
    if (collapsed) return { ...collapsed, normToOrig };
    return null;
  }

  let searchFrom = 0;
  let start = null;
  let end = null;

  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t];
    if (t > 0) {
      while (searchFrom < normalized.length && normalized[searchFrom] === ' ') searchFrom++;
    }
    const idx = normalized.indexOf(token, t === 0 ? 0 : searchFrom);
    if (idx === -1) return null;

    if (t > 0) {
      const gap = normalized.slice(end + 1, idx);
      if (gap.length > 0 && !/^\s+$/.test(gap)) return null;
    }

    if (start === null) start = idx;
    end = idx + token.length - 1;
    searchFrom = end + 1;
  }

  return { start, end, normToOrig };
}

function highlightRefLabel(label, query) {
  const escapeHtml = str =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const raw = (query || '').trim();
  if (!raw) return escapeHtml(label);

  const range = findHighlightRange(label, raw);
  if (!range) return escapeHtml(label);

  const highlightOrig = new Set();
  for (let k = range.start; k <= range.end; k++) {
    highlightOrig.add(range.normToOrig[k]);
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

  it('highlights multi-word queries as one block including the space', () => {
    expect(highlightRefLabel('Les avants de Toulouse', 'les avan')).toBe(
      '<span class="ref-match">Les avan</span>ts de Toulouse'
    );
  });

  it('keeps one highlight span when the label has extra whitespace', () => {
    const html = highlightRefLabel('Les  avants', 'les avan');
    expect(html).toBe('<span class="ref-match">Les  avan</span>ts');
    expect(html.match(/ref-match/g)).toHaveLength(1);
  });

  it('highlights when spaces are omitted from the query', () => {
    expect(highlightRefLabel('Les avants de Toulouse', 'lesavan')).toBe(
      '<span class="ref-match">Les avan</span>ts de Toulouse'
    );
  });

  it('does not scatter highlights when tokens are not adjacent in the label', () => {
    const html = highlightRefLabel(longLabel, 'les avan');
    expect(html).not.toContain('<span class="ref-match">');
    expect(html).toBe(longLabel);
  });

  it('does not highlight collapsed matches separated by other characters', () => {
    const html = highlightRefLabel(longLabel, 'lesavan');
    expect(html).not.toContain('<span class="ref-match">');
    expect(html).toBe(longLabel);
  });

  it('highlights accent-insensitive contiguous matches', () => {
    expect(highlightRefLabel('Café Central', 'cafe')).toBe(
      '<span class="ref-match">Café</span> Central'
    );
  });
});
