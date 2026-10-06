// Hadith verification: search Dorar, align each result with the quote word by word,
// group by narrator, prefer the Sahihayn, and derive one of the five JIHBATH statuses.
import { tokenize, wordSim } from './arabic.js';
import { lcsPairs, diffOps } from './align.js';
import { searchDorar } from './dorar.js';
import { classifyGrade, cleanGrade, isSahihayn } from './grades.js';

function compare(quote, text) {
  const q = tokenize(quote), s = tokenize(text);
  const pairs = lcsPairs(q.norm, s.norm);
  if (!pairs.length) return { coverage: 0, ops: [], closeness: 0 };
  const first = pairs[0][1], last = pairs[pairs.length - 1][1] + 1;
  const qInner = pairs[pairs.length - 1][0] - pairs[0][0] + 1 - pairs.length;
  const gaps = Math.max(0, last - first - pairs.length - qInner); // replacements are not gaps
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

  // Following the shari'a mentor's review: no verdict is computed by counting. The hadith is
  // labelled only when the verdicts agree (or it is in the Sahihayn); any disagreement is
  // shown as such and referred to a specialist. Verbatim verdicts are always displayed.
  const isExact = (m) => m.ops.every((o) => o.type === 'equal');
  const sahihayn = matches.find((m) => m.sahihayn);
  const of = (c) => matches.filter((m) => m.category === c);
  const strongs = of('strong'), isnads = of('isnad'), weaks = of('weak'), fabs = of('fabricated');
  const positive = strongs.length + isnads.length, negative = weaks.length + fabs.length;

  // closest wording among the narrations graded positively (for display only)
  const pool = matches.filter((m) => m.sahihayn || m.category === 'strong' || m.category === 'isnad');
  pool.sort((a, b) => Number(isExact(b)) - Number(isExact(a)) || b.closeness - a.closeness || Number(b.sahihayn) - Number(a.sahihayn));

  let status, basis, lead, alsoIn = null;
  if (sahihayn) {
    lead = pool[0] || sahihayn;
    if (!lead.sahihayn) alsoIn = sahihayn;
    basis = 'sahihayn';
    status = isExact(lead) ? 'exact' : 'variant';
  } else if (strongs.length && !negative) {
    lead = pool[0];
    basis = 'graded_authentic';
    status = isExact(lead) ? 'exact' : 'variant';
  } else if (positive && negative) {
    lead = pool[0] || matches[0];
    basis = 'disputed';
    status = 'review';
  } else if (negative) {
    lead = (fabs.length && !weaks.length) ? fabs[0] : (weaks[0] || fabs[0]);
    basis = fabs.length && !weaks.length ? 'graded_fabricated' : 'graded_weak';
    status = 'weak';
  } else {
    lead = isnads[0] || matches[0];
    basis = isnads.length ? 'isnad_only' : 'not_explicit';
    status = 'review';
  }

  return {
    status,
    lead: pick(lead),
    alsoIn: alsoIn ? pick(alsoIn) : null,
    groups: groups.map((g) => ({ rawi: g.rawi, narrations: g.narrations, ...pick(g.best) })),
    basis,
    verdicts: { strong: strongs.length, isnad: isnads.length, weak: weaks.length, fabricated: fabs.length, other: matches.length - positive - negative },
    checked: items.length,
    source: 'dorar.net — الموسوعة الحديثية',
  };
}

const pick = (m) => ({
  text: m.text, rawi: m.rawi, muhaddith: m.muhaddith, source: m.source, number: m.number,
  grade: m.grade, category: m.category, sahihayn: m.sahihayn,
  coverage: Number(m.coverage.toFixed(2)), ops: m.ops,
});
