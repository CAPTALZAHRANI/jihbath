// Hadith verification: search Dorar, align each result with the quote word by word,
// group by narrator, prefer the Sahihayn, and derive one of the five JIHBATH statuses.
import { tokenize, normalizeWord } from './arabic.js';
import { lcsPairs, diffOps } from './align.js';
import { searchDorar } from './dorar.js';
import { classifyGrade, cleanGrade, isSahihayn } from './grades.js';

// Letter-level similarity (0..1) between two words, ignoring diacritics
function wordSim(a, b) {
  a = normalizeWord(a); b = normalizeWord(b);
  if (!a || !b) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}

function compare(quote, text) {
  const q = tokenize(quote), s = tokenize(text);
  const pairs = lcsPairs(q.norm, s.norm);
  if (!pairs.length) return { coverage: 0, ops: [], closeness: 0 };
  const first = pairs[0][1], last = pairs[pairs.length - 1][1] + 1;
  const gaps = last - first - pairs.length;
  const coverage = Math.max(0, (pairs.length - 0.5 * gaps) / q.norm.length);
  const lead = pairs[0][0], trail = q.norm.length - 1 - pairs[pairs.length - 1][0];
  const from = Math.max(0, first - lead), to = Math.min(s.norm.length, last + trail);
  const ops = diffOps(q.orig, s.orig.slice(from, to), pairs.map(([qi, si]) => [qi, si - from]));
  // Closeness: a misquoted word that has a near-identical counterpart (كهاتان/كهاتين)
  // means this narration is closer to the quote than one where the word is simply absent.
  const bonus = ops.filter((o) => o.type === 'replace')
    .reduce((t, o) => t + Math.max(...o.said.flatMap((w) => o.source.map((x) => wordSim(w, x)))), 0);
  return { coverage, ops, closeness: coverage + bonus / q.norm.length };
}

export async function verifyHadith(quote, opts = {}) {
  const first = await searchDorar(quote);
  let result = judge(quote, first.items, opts);

  // A misquoted word also narrows Dorar's search (it looks for every word), so the
  // narration with the correct word may never come back. Search once more without the
  // words that did not match, merge, and judge again.
  if (result.status === 'variant' || result.status === 'not_found') {
    const bad = new Set((result.lead?.ops || [])
      .filter((o) => o.type === 'replace' || o.type === 'added')
      .flatMap((o) => o.said));
    const words = quote.trim().split(/\s+/);
    const widened = words.filter((w) => !bad.has(w)).join(' ');
    if (bad.size && widened.split(' ').length >= 3 && widened !== quote.trim()) {
      try {
        const second = await searchDorar(widened);
        const seen = new Set(first.items.map(key));
        const merged = [...first.items, ...second.items.filter((it) => !seen.has(key(it)))];
        result = judge(quote, merged, opts);
        result.widenedSearch = widened;
      } catch { /* keep the first result if the second search fails */ }
    }
  }
  return result;
}

const key = (it) => `${it.source}|${it.number}|${it.text}`;

function judge(quote, items, { minCoverage = 0.6 } = {}) {
  const matches = items
    .map((it) => ({
      ...it,
      grade: cleanGrade(it.grade),
      ...compare(quote, it.text),
      category: classifyGrade(it.grade),
      sahihayn: isSahihayn(it.source, it.muhaddith),
    }))
    .filter((m) => m.coverage >= minCoverage)
    .sort((a, b) => b.coverage - a.coverage || Number(b.sahihayn) - Number(a.sahihayn));

  if (!matches.length) {
    return { status: 'not_found', checked: items.length, source: 'dorar.net' };
  }

  // Group by narrator: a grade belongs to a specific chain, not to the wording.
  const byRawi = new Map();
  for (const m of matches) {
    const k = m.rawi || '—';
    if (!byRawi.has(k)) byRawi.set(k, []);
    byRawi.get(k).push(m);
  }
  const groups = [...byRawi.entries()].map(([rawi, list]) => ({
    rawi,
    best: list.find((m) => m.sahihayn) || list[0],
    narrations: list.length,
  }));

  // A grade belongs to a chain. The hadith is treated as established when it is in the
  // Sahihayn, or when authentic verdicts are at least as many as weak ones. When weak
  // verdicts outnumber authentic ones, we do not decide: it goes to specialist review.
  const sahihayn = matches.find((m) => m.sahihayn);
  const strongs = matches.filter((m) => m.category === 'strong');
  const weaks = matches.filter((m) => m.category === 'weak');

  let status, lead;
  const isExact = (m) => m.ops.every((o) => o.type === 'equal');
  let alsoIn = null;
  if (sahihayn || (strongs.length && strongs.length >= weaks.length)) {
    // Lead with the authentic narration closest to the quoted wording;
    // the Sahihayn wins ties, and is still cited when another wording is closer.
    const pool = matches.filter((m) => m.sahihayn || m.category === 'strong');
    pool.sort((a, b) => Number(isExact(b)) - Number(isExact(a)) || b.closeness - a.closeness || Number(b.sahihayn) - Number(a.sahihayn));
    lead = pool[0];
    if (!lead.sahihayn && sahihayn) alsoIn = sahihayn;
    status = isExact(lead) ? 'exact' : 'variant';
  } else if (weaks.length && !strongs.length) {
    lead = weaks[0];
    status = 'weak';
  } else {
    lead = strongs[0] || weaks[0] || matches[0];
    status = 'review';
  }

  return {
    status,
    lead: pick(lead),
    alsoIn: alsoIn ? pick(alsoIn) : null,
    groups: groups.map((g) => ({ rawi: g.rawi, narrations: g.narrations, ...pick(g.best) })),
    verdicts: { strong: strongs.length, weak: weaks.length, other: matches.length - strongs.length - weaks.length },
    checked: items.length,
    source: 'dorar.net — الموسوعة الحديثية',
  };
}

const pick = (m) => ({
  text: m.text, rawi: m.rawi, muhaddith: m.muhaddith, source: m.source, number: m.number,
  grade: m.grade, category: m.category, sahihayn: m.sahihayn,
  coverage: Number(m.coverage.toFixed(2)), ops: m.ops,
});
