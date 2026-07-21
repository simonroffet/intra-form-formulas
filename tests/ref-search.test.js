// Tests for Ref search fuzzy matching and option filtering.
// Logic mirrors app.js — update both if the algorithm changes.
import { describe, it, expect } from 'vitest';

function normalizeText(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function fuzzyScore(query, label) {
  const q = normalizeText(query);
  const t = normalizeText(label);
  if (!q) return 0;

  const idx = t.indexOf(q);
  if (idx !== -1) return idx;

  const maxErrors = Math.max(1, Math.floor(q.length / 3));
  let best = Infinity;

  for (let i = 0; i + q.length - 1 < t.length; i++) {
    best = Math.min(best, levenshtein(q, t.substr(i, q.length)));
    best = Math.min(best, levenshtein(q, t.substr(i, q.length + 1)));
    if (best === 0) break;
  }
  for (const word of t.split(/\s+/)) {
    best = Math.min(best, levenshtein(q, word));
  }

  return best <= maxErrors ? 1000 + best : null;
}

function filteredRefOptions(opts, query) {
  const q = (query || '').trim();
  if (!q) return opts;
  const scored = opts.map(opt => ({ opt, score: fuzzyScore(q, opt.label) }));
  if (!scored.some(entry => entry.score !== null)) return [];
  return scored
    .sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity))
    .map(entry => entry.opt);
}

const sampleOpts = [
  { id: 1, label: 'Alice Martin' },
  { id: 2, label: 'Bob Dupont' },
  { id: 3, label: 'Charlie Durand' },
];

describe('Ref search — filteredRefOptions', () => {
  it('returns all options when the query is empty', () => {
    expect(filteredRefOptions(sampleOpts, '')).toEqual(sampleOpts);
  });

  it('puts matching options first and keeps non-matches at the end', () => {
    const result = filteredRefOptions(sampleOpts, 'bob');
    expect(result.map(o => o.label)).toEqual([
      'Bob Dupont',
      'Alice Martin',
      'Charlie Durand',
    ]);
  });

  it('returns an empty list when nothing matches (shows "Aucun résultat")', () => {
    expect(filteredRefOptions(sampleOpts, 'zzz')).toEqual([]);
  });

  it('matches without accents (é -> e)', () => {
    const opts = [{ id: 1, label: 'Café Central' }];
    expect(filteredRefOptions(opts, 'cafe')).toEqual(opts);
  });
});
