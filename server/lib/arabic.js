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

