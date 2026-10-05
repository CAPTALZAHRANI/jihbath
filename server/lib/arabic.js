// Arabic text normalization for matching.
// Matching is tolerant (no diacritics, unified alef/ya/ta-marbuta/hamza seats);
// what we SHOW the user is always the original source text.

const MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF]/g;
const INVISIBLE = /[\uFEFF\u200B-\u200F\u202A-\u202E\u2066-\u2069\u0640]/g; // BOM, zero-width, bidi, tatweel

export function clean(s) {
  return String(s || '').replace(INVISIBLE, '').trim();
}

export function normalizeWord(s) {
  return clean(s)
    .replace(MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\u0621-\u064A]/g, '');
}

// Split text into parallel arrays: original tokens and their normalized forms.
// Tokens that normalize to nothing (ayah markers, symbols, punctuation) are dropped.
export function tokenize(text) {
  const orig = [];
  const norm = [];
  for (const t of clean(text).split(/\s+/)) {
    const n = normalizeWord(t);
    if (n) { orig.push(t); norm.push(n); }
  }
  return { orig, norm };
}

// Letter-level similarity (0..1) between two words, ignoring diacritics
export function wordSim(a, b) {
  a = normalizeWord(a); b = normalizeWord(b);
  if (!a || !b) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}


// Words of a text with their character offsets (normalized form included), for scanning
// a whole text for unmarked quotations.
export function wordsWithOffsets(text) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const n = normalizeWord(m[0]);
    // offsets exclude punctuation glued to the word («ليعبدون،» keeps its comma outside)
    const lead = m[0].match(/^[^\p{L}\p{M}]*/u)[0].length;
    const trail = m[0].match(/[^\p{L}\p{M}]*$/u)[0].length;
    if (n) out.push({ orig: m[0], norm: n, start: m.index + lead, end: m.index + m[0].length - trail });
  }
  return out;
}

// Scans text words against an n-gram index of a reference stream and returns runs of
// consecutive words that continue the same stream positions (a verbatim quotation).
export function findRuns(words, gramIndex, n, minWords) {
  const runs = [];
  let cur = null, runStart = -1;
  for (let i = 0; i + n <= words.length; i++) {
    const key = words.slice(i, i + n).map((w) => w.norm).join(' ');
    const hits = gramIndex.get(key);
    const next = cur && hits ? hits.filter((p) => cur.has(p - 1)) : null;
    if (next && next.length) { cur = new Set(next); continue; }
    if (cur && i - 1 + n - runStart >= minWords) runs.push([runStart, i - 1 + n]);
    cur = hits ? new Set(hits) : null;
    runStart = i;
  }
  if (cur && words.length - runStart >= minWords) runs.push([runStart, words.length]);
  return runs; // [firstWordIndex, endWordIndexExclusive]
}
