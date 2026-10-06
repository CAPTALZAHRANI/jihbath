// HadeethEnc (hadeethenc.com) local index: a second, independent path for hadith,
// and the official English translations for checking translated content.
// On Railway the index lives on a persistent volume (HADEETHENC_DIR) and is built
// once in the background on first boot; until then this path reports "initializing".
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tokenize, wordsWithOffsets, findRuns } from './arabic.js';
import { lcsPairs, diffOps } from './align.js';
import { loadSemantic, semanticReady, searchByMeaning, meaningLevel, sharedWords, arContent, hadithWords } from './semantic.js';

const BASE = path.resolve(process.env.HADEETHENC_DIR || 'data');
const FILE = path.join(BASE, 'index/hadeethenc.json');
let IDX = null;
let state = 'missing'; // missing | initializing | ready | failed

const enTokens = (s) => {
  const orig = String(s || '').split(/\s+/).filter(Boolean);
  const pairs = orig.map((w) => [w, w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9']/g, '')]).filter(([, n]) => n);
  return { orig: pairs.map(([o]) => o), norm: pairs.map(([, n]) => n) };
};

function invert(list, key) {
  const inv = new Map();
  list.forEach((it, i) => { for (const w of new Set(it[key].norm)) { if (!inv.has(w)) inv.set(w, []); inv.get(w).push(i); } });
  return inv;
}

export function loadHadeethEnc() {
  if (!fs.existsSync(FILE)) return false;
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const items = raw.items.map((h) => ({ ...h, ar: tokenize(h.text), enTok: h.en ? enTokens(h.en.text) : { orig: [], norm: [] } }));
  // 4-gram index over the hadith texts themselves (inside «…»), for unmarked quotations
  const grams = new Map();
  let pos = 0;
  for (const h of items) {
    const core = (String(h.text).match(/«([^»]+)»/) || [null, h.text])[1];
    const n = tokenize(core).norm;
    for (let i = 0; i + 4 <= n.length; i++) {
      const k = n.slice(i, i + 4).join(' ');
      if (!grams.has(k)) grams.set(k, []);
      grams.get(k).push(pos + i);
    }
    pos += n.length + 10; // gap so runs never cross from one hadith into the next
  }
  IDX = { items, byId: new Map(items.map((h) => [h.id, h])), invAr: invert(items, 'ar'), invEn: invert(items, 'enTok'), built_at: raw.built_at, grams };
  state = 'ready';
  if (loadSemantic()) console.log('🧭 meaning-level index loaded');
  return true;
}

export const hadeethEncStatus = () => ({ state, count: IDX?.items.length || 0, built_at: IDX?.built_at || null, meaning: semanticReady() });

// First boot on Railway: fetch + build in the background, then load.
export function bootstrapHadeethEnc() {
  if (loadHadeethEnc() || process.env.HADEETHENC_AUTOFETCH !== '1') return;
  state = 'initializing';
  console.log(`⏳ HadeethEnc index missing — building in background into ${BASE}`);
  const run = (script) => new Promise((ok, fail) =>
    spawn(process.execPath, [script], { stdio: 'inherit', env: process.env })
      .on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${script} exited ${code}`)))));
  run('scripts/fetch-hadeethenc.js')
    .then(() => run('scripts/build-hadeethenc-index.js'))
    .then(() => { state = 'missing'; loadHadeethEnc(); state = 'initializing'; console.log('📚 HadeethEnc literal index ready; building meaning index…'); })
    .then(() => run('scripts/build-hadeethenc-embeddings.js'))
    .then(() => { loadHadeethEnc(); console.log('🧭 HadeethEnc meaning index ready'); })
    .catch((e) => { state = 'failed'; console.error('❌ HadeethEnc bootstrap failed:', e.message); });
}

const isArabic = (s) => /[\u0600-\u06FF]/.test(s);

export function verifyHadeethEnc(quote, { minCoverage = 0.6 } = {}) {
  if (!IDX) return { status: state === 'initializing' ? 'initializing' : 'unavailable' };
  const arabic = isArabic(quote);
  const q = arabic ? tokenize(quote) : enTokens(quote);
  if (q.norm.length < 3) return { status: 'too_short' };
  const inv = arabic ? IDX.invAr : IDX.invEn;
  const N = IDX.items.length;

  const score = new Map();
  for (const w of new Set(q.norm)) {
    const list = inv.get(w);
    if (!list || (N > 50 && list.length > N / 3)) continue; // skip very common words
    const idf = Math.log(N / list.length);
    for (const i of list) score.set(i, (score.get(i) || 0) + idf);
  }
  const candidates = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([i]) => i);

  let best = null;
  for (const i of candidates) {
    const it = IDX.items[i];
    const s = arabic ? it.ar : it.enTok;
    const pairs = lcsPairs(q.norm, s.norm);
    if (!pairs.length) continue;
    const first = pairs[0][1], last = pairs[pairs.length - 1][1] + 1;
    const qInner = pairs[pairs.length - 1][0] - pairs[0][0] + 1 - pairs.length;
    const gaps = Math.max(0, last - first - pairs.length - qInner);
    const coverage = (pairs.length - 0.5 * gaps) / q.norm.length;
    if (!best || coverage > best.coverage) best = { it, s, pairs, coverage, first, last };
  }
  if (!best || best.coverage < minCoverage) {
    return { status: 'not_found', language: arabic ? 'ar' : 'en', closest: best ? { id: best.it.id, coverage: Number(best.coverage.toFixed(2)) } : null };
  }

  const lead = best.pairs[0][0], trail = q.norm.length - 1 - best.pairs[best.pairs.length - 1][0];
  const from = Math.max(0, best.first - lead), to = Math.min(best.s.norm.length, best.last + trail);
  const ops = diffOps(q.orig, best.s.orig.slice(from, to), best.pairs.map(([qi, si]) => [qi, si - from]));
  const exact = ops.every((o) => o.type === 'equal');
  const { it } = best;
  return {
    status: exact ? 'exact' : 'variant',
    language: arabic ? 'ar' : 'en',
    match: arabic ? 'literal' : 'official_translation',
    coverage: Number(Math.min(1, best.coverage).toFixed(2)),
    ops,
    id: it.id,
    text: it.text,
    grade: it.grade,
    attribution: it.attribution,
    en: it.en,
    url: `https://hadeethenc.com/ar/browse/hadith/${it.id}`,
    source: 'HadeethEnc.com — موسوعة الأحاديث النبوية',
  };
}

// Meaning-level lookup for translated quotes (see semantic.js)
export async function verifyByMeaning(quote) {
  if (!IDX) return { status: state === 'initializing' ? 'initializing' : 'unavailable' };
  if (!semanticReady()) return { status: 'initializing' };
  const arabic = /[\u0600-\u06FF]/.test(quote);
  let top, shared, level, hits;
  if (arabic) {
    // Arabic↔Arabic similarities from this model bunch up (unrelated sentences reach ~0.78),
    // so wording leads: every hadith sharing 2+ content words with the quote (against its full
    // text, words weighted by rarity), then meaning breaks ties between close candidates.
    if (!IDX.arSets) {
      IDX.arSets = new Map(IDX.items.map((h) => [h.id, arContent(hadithWords(h.text))]));
      IDX.arDf = new Map();
      for (const set of IDX.arSets.values()) for (const w of set) IDX.arDf.set(w, (IDX.arDf.get(w) || 0) + 1);
    }
    const qWords = [...arContent(quote)];
    const N = IDX.items.length;
    const idf = (w) => Math.log(N / (1 + (IDX.arDf.get(w) || 0)));
    const lexical = [];
    for (const [id, set] of IDX.arSets) {
      const sh = qWords.filter((w) => set.has(w));
      if (sh.length >= 2) lexical.push({ id, shared: sh, lex: sh.reduce((t, w) => t + idf(w), 0) });
    }
    if (!lexical.length) return { status: 'not_found', closest: null };
    const sims = new Map(((await searchByMeaning(quote, Infinity, { arabicOnly: true })) || []).map((x) => [x.id, x]));
    const ranked = lexical
      .map((x) => ({ ...x, similarity: sims.get(x.id)?.similarity || 0, chunk: sims.get(x.id)?.chunk || '' }))
      .map((x) => ({ ...x, score: x.lex + 4 * x.similarity }))
      .sort((a, b) => b.score - a.score);
    top = ranked[0];
    shared = top.shared;
    level = top.similarity >= 0.8 ? 'strong' : 'possible';
    hits = ranked.slice(0, 3);
  } else {
    hits = await searchByMeaning(quote, 3);
    top = hits?.[0];
    shared = top ? sharedWords(quote, top.chunk) : [];
    level = top ? meaningLevel(top.similarity, shared) : 'none';
  }
  if (level === 'none') return { status: 'not_found', closest: top || null };
  const h = IDX.byId.get(top.id);
  return {
    status: level === 'strong' ? 'meaning' : 'meaning_possible',
    match: 'meaning',
    similarity: top.similarity,
    shared,
    matchedSentence: top.chunk,
    id: h.id, text: h.text, grade: h.grade, attribution: h.attribution, en: h.en,
    url: `https://hadeethenc.com/ar/browse/hadith/${h.id}`,
    others: hits.slice(1).map((x) => ({ id: x.id, similarity: x.similarity, title: IDX.byId.get(x.id)?.title })),
    source: 'HadeethEnc.com — موسوعة الأحاديث النبوية',
  };
}

const STOCK = new Set(['صلي', 'الله', 'عليه', 'وسلم', 'رضي', 'عنه', 'عنهما', 'عنها', 'عنهم', 'النبي', 'رسول', 'لرسول', 'برسول', 'عبد', 'بن', 'ابن', 'ابي', 'بنت', 'عن', 'قال', 'قالت', 'يقول', 'سمعت', 'مات', 'كان', 'ﷺ', 'ان', 'في', 'من', 'علي', 'الي', 'ما', 'لا', 'و', 'ثم', 'حدثنا', 'اخبرنا']);

// Hadiths written into the text with no «قال رسول الله ﷺ»: verbatim runs of 6+ words
// matching a hadith text in HadeethEnc (short stock phrases are not flagged).
export function findUnmarkedHadiths(text, taken = []) {
  if (!IDX?.grams) return [];
  const words = wordsWithOffsets(text);
  const out = [];
  for (const [a, b] of findRuns(words, IDX.grams, 4, 6)) {
    // Narrative stock phrases recur verbatim across hadith texts («مات النبي صلى الله عليه وسلم»,
    // «عبد الله بن عمر رضي الله عنهما»): only words beyond them can make a run a quotation.
    const meaningful = words.slice(a, b).filter((w) => !STOCK.has(w.norm));
    if (meaningful.length < 6) continue;
    const start = words[a].start, end = words[b - 1].end;
    if (taken.some(([x, y]) => start < y && end > x)) continue;
    out.push({ type: 'hadith', unmarked: true, text: text.slice(start, end), start, end });
  }
  return out;
}
