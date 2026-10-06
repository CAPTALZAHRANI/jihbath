// Full pipeline: text → claims → verification → report with the five JIHBATH statuses.
import { extractClaims } from './extract.js';
import { verifyQuran } from './quran.js';
import { verifyHadith } from './hadith.js';

// exact | variant | weak | not_found | review  (+ unavailable when a source cannot be reached)
const fromQuran = (r) => (r.status === 'exact' || r.status === 'exact_fragment' ? 'exact' : r.status === 'variant' ? 'variant' : 'not_found');

async function hadithOrUnavailable(text) {
  try { return await verifyHadith(text); }
  catch (e) { return { status: 'unavailable', error: e.message }; }
}

async function checkClaim(claim) {
  const out = { ...claim };

  if (claim.type === 'quran') {
    const q = verifyQuran(claim.text);
    if (q.status !== 'not_found' && q.status !== 'too_short') {
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
