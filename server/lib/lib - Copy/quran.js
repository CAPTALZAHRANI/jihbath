// Quran verification against the local Hafs index (built from Quranpedia's official dump).
import fs from 'node:fs';
import path from 'node:path';
import { tokenize, wordSim, wordsWithOffsets, findRuns } from './arabic.js';
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
  // 4-gram index over the whole mushaf in order (quotes may run across consecutive ayahs)
  const grams = new Map();
  const stream = [];
  for (const a of ayahs) for (const w of a.norm) stream.push(w);
  for (let i = 0; i + 4 <= stream.length; i++) {
    const k = stream.slice(i, i + 4).join(' ');
    if (!grams.has(k)) grams.set(k, []);
    grams.get(k).push(i);
  }
  IDX = { meta: { version: raw.version, source: raw.source }, names, ayahs, inv, grams };
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
  // Source words skipped inside the span, minus the quote words they line up against:
  // a misspelled word (السراط/الصراط) is a 1-to-1 replacement, not a gap.
  const qInner = matched ? pairs[matched - 1][0] - pairs[0][0] + 1 - matched : 0;
  const gaps = Math.max(0, spanEnd - spanStart - matched - qInner);
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
  // A misspelled word that closely resembles the source word earns partial credit,
  // so short quotes with one typo (السراط ← الصراط) are still found.
  let simBonus = 0;
  if (best?.pairs.length) {
    const qi0 = best.pairs[0][0], si0 = best.pairs[0][1];
    for (let k = 0; k < best.pairs.length; k++) {
      const [qi, si] = best.pairs[k];
      const [nq, ns] = best.pairs[k + 1] || [qi + 1 + (q.norm.length - 1 - qi), si + 1 + (q.norm.length - 1 - qi)];
      const qGap = q.norm.slice(qi + 1, nq), sGap = best.sNorm.slice(si + 1, ns);
      for (let t = 0; t < Math.min(qGap.length, sGap.length); t++) {
        const sim = wordSim(qGap[t], sGap[t]);
        if (sim >= 0.6) simBonus += 0.5 * sim;
      }
    }
    for (let t = 1; t <= Math.min(qi0, si0); t++) { // leading misspelled words
      const sim = wordSim(q.norm[qi0 - t], best.sNorm[si0 - t]);
      if (sim >= 0.6) simBonus += 0.5 * sim;
    }
  }
  const coverage = best ? Math.min(1, (best.matched - 0.5 * best.gaps + simBonus) / q.norm.length) : 0;
  if (!best || coverage < minCoverage) {
    return { status: 'not_found', coverage: Number(Math.max(0, coverage).toFixed(2)) };
  }

  // Extend the span by as many source words as the quote has unmatched words at each edge,
  // so "ليعبدوني" lines up against "لِيَعْبُدُونِ" as a replacement, not an addition.
  const lead = best.pairs[0][0];
  const trail = q.norm.length - 1 - best.pairs[best.pairs.length - 1][0];
  let from = Math.max(0, best.spanStart - lead);
  const to = Math.min(best.sNorm.length, best.spanEnd + trail);
  // A quote that starts right after a particle of the same ayah («الناس من يعبد الله على حرف»
  // for «وَمِنَ النَّاسِ مَن يَعْبُدُ…») drops words that carry the meaning: the particles are
  // pulled back into the span, so they show as missing words instead of an "exact fragment".
  const PARTICLES = new Set(['و', 'ف', 'ومن', 'من', 'في', 'وفي', 'ان', 'وان', 'فان', 'لا', 'ولا', 'ما', 'وما', 'فما', 'يا', 'ثم', 'او', 'بل', 'قد', 'لقد', 'ولقد', 'انما', 'الا', 'ان', 'لم', 'ولم', 'لن', 'ولن', 'كل', 'وكل', 'هل', 'اذا', 'واذا', 'فاذا']);
  for (let k = 0; k < 2 && from > 0 && best.sAyah[from - 1] === best.sAyah[from] && PARTICLES.has(best.sNorm[from - 1]); k++) from--;
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

// The Arabic ayah for a reference (used when a translated quote is returned to its origin)
export function ayahByRef(surah, ayah) {
  if (!IDX) return null;
  const a = IDX.ayahs.find((x) => x.s === surah && x.a === ayah);
  return a ? { text: a.text, ref: { surah, surahName: IDX.names.get(surah), from: ayah, to: ayah } } : null;
}

// Ayahs written into the text with no «قال تعالى» and no brackets: verbatim runs of 5+ words
// (so the basmala and short common phrases are not flagged) that are not already claims.
export function findUnmarkedAyahs(text, taken = []) {
  if (!IDX) return [];
  const words = wordsWithOffsets(text);
  const out = [];
  for (const [a, b] of findRuns(words, IDX.grams, 4, 5)) {
    const start = words[a].start, end = words[b - 1].end;
    if (taken.some(([x, y]) => start < y && end > x)) continue;
    out.push({ type: 'quran', unmarked: true, text: text.slice(start, end), start, end });
  }
  return out;
}
