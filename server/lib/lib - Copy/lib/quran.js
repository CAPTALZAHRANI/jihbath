// Quran verification against the local Hafs index (built from Quranpedia's official dump).
import fs from 'node:fs';
import path from 'node:path';
import { tokenize } from './arabic.js';
import { lcsPairs, diffOps } from './align.js';

let IDX = null;

export function loadQuran(file = path.resolve('data/index/quran.json')) {
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const names = new Map(raw.surahs.map((s) => [s.id, s.name]));
  const ayahs = raw.ayahs.map((a) => ({ ...a, ...tokenize(a.text) }));
  const inv = new Map();
  ayahs.forEach((a, i) => {
    for (const w of new Set(a.norm)) {
      if (!inv.has(w)) inv.set(w, []);
      inv.get(w).push(i);
    }
  });
  IDX = { meta: { version: raw.version, source: raw.source }, names, ayahs, inv };
  return IDX;
}

export const quranReady = () => !!IDX;

function windowsAround(i) {
  const { ayahs } = IDX;
  const same = (k) => ayahs[k] && ayahs[k].s === ayahs[i].s;
  const w = [[i]];
  if (same(i + 1)) w.push([i, i + 1]);
  if (same(i - 1)) w.push([i - 1, i]);
  if (same(i - 1) && same(i + 1)) w.push([i - 1, i, i + 1]);
  return w;
}

function evaluate(q, win, idf) {
  const { ayahs } = IDX;
  const sOrig = [], sNorm = [], sAyah = [];
  for (const k of win) {
    sOrig.push(...ayahs[k].orig);
    sNorm.push(...ayahs[k].norm);
    for (let t = 0; t < ayahs[k].norm.length; t++) sAyah.push(k);
  }
  const pairs = lcsPairs(q.norm, sNorm);
  const matched = pairs.length;
  const spanStart = matched ? pairs[0][1] : 0;
  const spanEnd = matched ? pairs[matched - 1][1] + 1 : 0;
  const gaps = Math.max(0, spanEnd - spanStart - matched); // source words skipped inside the quote
  // Scattered matches are penalised so a compact span wins over a few words spread across ayahs.
  const score = matched - 0.5 * gaps;
  const weight = pairs.reduce((t, [qi]) => t + idf(q.norm[qi]), 0); // rare words count more
  const qMatched = pairs.map(([qi]) => qi).join(',');
  const covered = [...new Set(sAyah.slice(spanStart, spanEnd))];
  return { win, sOrig, sNorm, sAyah, pairs, matched, gaps, score, weight, qMatched, spanStart, spanEnd, covered };
}

export function verifyQuran(input, { minCoverage = 0.6 } = {}) {
  if (!IDX) return { status: 'unavailable' };
  const q = tokenize(input);
  if (q.norm.length < 2) return { status: 'too_short' };

  // 1) candidate ayahs by rare-word overlap (idf)
  const N = IDX.ayahs.length;
  const idfScore = new Map();
  for (const w of new Set(q.norm)) {
    const list = IDX.inv.get(w);
    if (!list) continue;
    const idf = Math.log(N / list.length);
    for (const i of list) idfScore.set(i, (idfScore.get(i) || 0) + idf);
  }
  const idf = (w) => { const l = IDX.inv.get(w); return l ? Math.log(N / l.length) : 0; };
  const candidates = [...idfScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([i]) => i);

  // 2) word alignment on each candidate and its neighbours
  const results = [];
  for (const i of candidates) for (const win of windowsAround(i)) results.push(evaluate(q, win, idf));
  results.sort((a, b) => b.score - a.score || b.weight - a.weight || a.covered.length - b.covered.length || a.win.length - b.win.length);

  const best = results[0];
  const coverage = best ? (best.matched - 0.5 * best.gaps) / q.norm.length : 0;
  if (!best || coverage < minCoverage) {
    return { status: 'not_found', coverage: Number(Math.max(0, coverage).toFixed(2)) };
  }

  // Extend the span by as many source words as the quote has unmatched words at each edge,
  // so "ليعبدوني" lines up against "لِيَعْبُدُونِ" as a replacement, not an addition.
  const lead = best.pairs[0][0];
  const trail = q.norm.length - 1 - best.pairs[best.pairs.length - 1][0];
  const from = Math.max(0, best.spanStart - lead);
  const to = Math.min(best.sNorm.length, best.spanEnd + trail);
  const ops = diffOps(q.orig, best.sOrig.slice(from, to), best.pairs.map(([qi, si]) => [qi, si - from]));
  const exact = ops.every((o) => o.type === 'equal');

  // The ayahs actually quoted (not the whole search window)
  const covered = [...new Set(best.sAyah.slice(from, to))];
  const firstWord = best.sAyah.indexOf(covered[0]);
  const lastWord = best.sAyah.lastIndexOf(covered[covered.length - 1]) + 1;
  const fragment = from > firstWord || to < lastWord;

  // Other places with an equally good match (repeated phrases), excluding the quoted ayahs
  const used = new Set(covered);
  const keys = new Set();
  const alternatives = [];
  for (const r of results) {
    if (alternatives.length >= 3) break;
    if (r === best || r.score !== best.score || r.qMatched !== best.qMatched) continue; // same quoted words only
    if (r.covered.some((k) => used.has(k))) continue;
    const key = r.covered.join(',');
    if (keys.has(key)) continue;
    keys.add(key);
    alternatives.push(refOf(r.covered));
  }

  return {
    status: exact ? (fragment ? 'exact_fragment' : 'exact') : 'variant',
    coverage: Number(coverage.toFixed(2)),
    ref: refOf(covered),
    text: covered.map((k) => IDX.ayahs[k].text).join(' '),
    ops,
    alternatives,
    source: { name: 'الموسوعة القرآنية quranpedia.net', version: IDX.meta.version, url: 'https://quranpedia.net' },
  };
}

function refOf(win) {
  const a = IDX.ayahs[win[0]], b = IDX.ayahs[win[win.length - 1]];
  return { surah: a.s, surahName: IDX.names.get(a.s), from: a.a, to: b.a };
}
