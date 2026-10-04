// Full pipeline: text → claims → verification → report with the five JIHBATH statuses.
import { extractClaims } from './extract.js';
import { verifyQuran } from './quran.js';
import { verifyHadith } from './hadith.js';

// exact | variant | weak | not_found | review  (+ unavailable when a source cannot be reached)
const fromQuran = (r) => (r.status === 'exact' || r.status === 'exact_fragment' ? 'exact' : r.status === 'variant' ? 'variant' : 'not_found');

// Detects two verses fused into one quote (common in sermons): the unmatched part of the
// quote, plus up to two neighbouring matched words, is looked up as a verse on its own.
function detectMerge(q) {
  const words = [];
  for (const o of q.ops || []) for (const w of o.said) words.push({ w, eq: o.type === 'equal' });
  const bad = words.map((x, i) => (x.eq ? -1 : i)).filter((i) => i >= 0);
  if (!bad.length) return null;
  let a = bad[0], b = bad[bad.length - 1];
  for (let k = 0; k < 2 && a > 0 && words[a - 1].eq; k++) a--;
  for (let k = 0; k < 2 && b < words.length - 1 && words[b + 1].eq; k++) b++;
  const part = words.slice(a, b + 1).map((x) => x.w).join(' ');
  if (b - a + 1 < 3) return null;
  const other = verifyQuran(part);
  const sameAyah = other.ref && q.ref && other.ref.surah === q.ref.surah && other.ref.from <= q.ref.to && other.ref.to >= q.ref.from;
  if (other.status === 'not_found' || other.status === 'too_short' || sameAyah || other.coverage < 0.85) return null;
  const first = words.slice(0, a).filter((x) => x.eq).map((x) => x.w).join(' ');
  return { part, first, quran: other };
}

async function hadithOrUnavailable(text) {
  try { return await verifyHadith(text); }
  catch (e) { return { status: 'unavailable', error: e.message }; }
}

async function checkClaim(claim) {
  const out = { ...claim };

  if (claim.type === 'quran') {
    const q = verifyQuran(claim.text);
    if (q.status !== 'not_found' && q.status !== 'too_short') {
      const merged = q.status === 'variant' ? detectMerge(q) : null;
      if (merged) {
        return { ...out, status: 'variant', kind: 'quran', merged, quran: q,
          note: `دُمجت هنا آيتان من موضعين مختلفين: «${merged.part}» من موضع آخر` };
      }
      return { ...out, status: fromQuran(q), kind: 'quran', fragment: q.status === 'exact_fragment', quran: q };
    }
    const h = await hadithOrUnavailable(claim.text);
    if (['exact', 'variant', 'weak', 'review'].includes(h.status)) {
      return { ...out, status: 'review', kind: 'hadith', misattributed: true, note: 'نُسب إلى القرآن، وليس آية؛ ورد في كتب الحديث', hadith: h };
    }
    return { ...out, status: 'not_found', kind: 'quran', quran: q };
  }

  // hadith or unknown: an ayah quoted as a hadith must be caught first
  const q = verifyQuran(claim.text);
  const isAyah = (q.status === 'exact' || q.status === 'exact_fragment' || q.status === 'variant') && q.coverage >= 0.85;
  if (isAyah) {
    // Correct text, wrong attribution: never shown as fully "exact"
    if (claim.type === 'hadith') {
      return { ...out, status: 'variant', kind: 'quran', misattributed: true, note: 'هذه آية من القرآن الكريم، وليست حديثًا', quran: q };
    }
    return { ...out, status: fromQuran(q), kind: 'quran', fragment: q.status === 'exact_fragment', quran: q };
  }

  const h = await hadithOrUnavailable(claim.text);
  return { ...out, status: h.status, kind: 'hadith', hadith: h };
}

export async function checkText(text) {
  const claims = extractClaims(text);
  const results = [];
  for (const c of claims) results.push(await checkClaim(c)); // sequential: gentle on Dorar
  const summary = results.reduce((s, r) => ({ ...s, [r.status]: (s[r.status] || 0) + 1 }), {});
  return { claims: results, summary, total: results.length };
}
