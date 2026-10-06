// Translated Quran quotes (English): matched word by word against several official
// translations from QuranEnc.com, then returned to the Arabic ayah in the Hafs mushaf.
import fs from 'node:fs';
import path from 'node:path';
import { lcsPairs, diffOps } from './align.js';

const FILE = path.resolve(process.env.QURANENC_DIR || 'data', 'index/quranenc.json');
let IDX = null;

// Footnote markers like [1] or (1) are part of the published text but not of a quote
const tokens = (s) => {
  const orig = String(s || '').replace(/\[\d+\]|\(\d+\)/g, ' ').split(/\s+/).filter(Boolean);
  const pairs = orig.map((w) => [w, w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']/g, '')]).filter(([, n]) => n);
  return { orig: pairs.map(([o]) => o), norm: pairs.map(([, n]) => n) };
};

export function loadQuranEnc() {
  if (!fs.existsSync(FILE)) return false;
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const ayahs = raw.ayahs.map((a) => ({ ...a, tok: tokens(a.t) }));
  const inv = new Map();
  ayahs.forEach((a, i) => { for (const w of new Set(a.tok.norm)) { if (!inv.has(w)) inv.set(w, []); inv.get(w).push(i); } });
  IDX = { translations: raw.translations, ayahs, inv };
  return true;
}
export const quranEncReady = () => !!IDX;

export function verifyQuranEnglish(quote, { minCoverage = 0.6 } = {}) {
  if (!IDX) return { status: 'unavailable' };
  const q = tokens(quote);
  if (q.norm.length < 3) return { status: 'too_short' };
  const N = IDX.ayahs.length;
  const score = new Map();
  for (const w of new Set(q.norm)) {
    const list = IDX.inv.get(w);
    if (!list || (N > 200 && list.length > N / 4)) continue; // skip "the", "and", "allah"…
    const idf = Math.log(N / list.length);
    for (const i of list) score.set(i, (score.get(i) || 0) + idf);
  }
  // Short quotes often share their only rare word ("patient") with hundreds of ayahs across
  // three translations, so keep a wide candidate pool: word alignment on each is cheap.
  const cands = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400).map(([i]) => i);

  let best = null;
  for (const i of cands) {
    const a = IDX.ayahs[i];
    const pairs = lcsPairs(q.norm, a.tok.norm);
    if (!pairs.length) continue;
    const first = pairs[0][1], last = pairs[pairs.length - 1][1] + 1;
    const qInner = pairs[pairs.length - 1][0] - pairs[0][0] + 1 - pairs.length;
    const gaps = Math.max(0, last - first - pairs.length - qInner);
    const coverage = (pairs.length - 0.5 * gaps) / q.norm.length;
    if (!best || coverage > best.coverage) best = { a, pairs, coverage, first, last };
  }
  if (!best || best.coverage < minCoverage) return { status: 'not_found' };

  const lead = best.pairs[0][0], trail = q.norm.length - 1 - best.pairs[best.pairs.length - 1][0];
  const from = Math.max(0, best.first - lead), to = Math.min(best.a.tok.norm.length, best.last + trail);
  const ops = diffOps(q.orig, best.a.tok.orig.slice(from, to), best.pairs.map(([qi, si]) => [qi, si - from]));
  const t = IDX.translations[best.a.k];
  return {
    status: ops.every((o) => o.type === 'equal') ? 'exact' : 'variant',
    coverage: Number(Math.min(1, best.coverage).toFixed(2)),
    surah: best.a.s, ayah: best.a.a,
    translation: { text: best.a.t, key: t.key, title: t.title, version: t.version, url: `https://quranenc.com/en/browse/${t.key}/${best.a.s}#${best.a.a}` },
    ops,
  };
}
