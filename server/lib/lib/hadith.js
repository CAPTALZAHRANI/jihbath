// Hadith verification: search Dorar, align each result with the quote word by word,
// group by narrator, prefer the Sahihayn, and derive one of the five JIHBATH statuses.
import { tokenize } from './arabic.js';
import { lcsPairs, diffOps } from './align.js';
import { searchDorar } from './dorar.js';
import { classifyGrade, cleanGrade, isSahihayn } from './grades.js';

function compare(quote, text) {
  const q = tokenize(quote), s = tokenize(text);
  const pairs = lcsPairs(q.norm, s.norm);
  if (!pairs.length) return { coverage: 0, ops: [] };
  const first = pairs[0][1], last = pairs[pairs.length - 1][1] + 1;
  const gaps = last - first - pairs.length;
  const coverage = Math.max(0, (pairs.length - 0.5 * gaps) / q.norm.length);
  const lead = pairs[0][0], trail = q.norm.length - 1 - pairs[pairs.length - 1][0];
  const from = Math.max(0, first - lead), to = Math.min(s.norm.length, last + trail);
  const ops = diffOps(q.orig, s.orig.slice(from, to), pairs.map(([qi, si]) => [qi, si - from]));
  return { coverage, ops };
}

export async function verifyHadith(quote, { minCoverage = 0.6 } = {}) {
  const { items } = await searchDorar(quote);
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
  if (sahihayn || (strongs.length && strongs.length >= weaks.length)) {
    lead = sahihayn || strongs[0];
    status = lead.ops.every((o) => o.type === 'equal') ? 'exact' : 'variant';
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
