// Full pipeline: text → claims → verification → report with the five JIHBATH statuses.
import { extractClaims } from './extract.js';
import { verifyQuran } from './quran.js';
import { verifyHadith } from './hadith.js';
import { verifyHadeethEnc, verifyByMeaning } from './hadeethenc.js';

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

  // Translated (English) claim: matched against HadeethEnc's official translations
  if (!/[\u0600-\u06FF]/.test(claim.text)) {
    const he = verifyHadeethEnc(claim.text);
    // 1) the quote follows HadeethEnc's own translation word for word
    if (he.status === 'exact' || he.status === 'variant') return { ...out, status: he.status, kind: 'hadith', translated: true, hadeethenc: he };
    // 2) agreed design: translated text is matched by MEANING
    const m = await verifyByMeaning(claim.text);
    if (m.status === 'meaning') return { ...out, status: 'variant', kind: 'hadith', translated: true, meaning: true, hadeethenc: m };
    if (m.status === 'meaning_possible') {
      return { ...out, status: 'review', kind: 'hadith', translated: true, meaning: true, hadeethenc: m,
        note: 'قريب في المعنى من حديث ثابت، لكن التشابه غير كافٍ للجزم بأنه هو؛ قد يكون قولًا آخر يشبهه' };
    }
    if (he.status === 'initializing' || m.status === 'initializing') {
      return { ...out, status: 'unavailable', kind: 'hadith', translated: true, note: 'موسوعة الأحاديث النبوية قيد التهيئة على الخادم؛ أعد المحاولة لاحقًا' };
    }
    return { ...out, status: 'not_found', kind: 'hadith', translated: true, hadeethenc: he };
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

  // Two independent paths: Dorar (live, chain-level verdicts) and HadeethEnc (local index)
  const [h, he] = [await hadithOrUnavailable(claim.text), verifyHadeethEnc(claim.text)];
  const heFound = he.status === 'exact' || he.status === 'variant';
  const paths = [h.status !== 'not_found' && h.status !== 'unavailable', heFound].filter(Boolean).length;

  // Dorar unreachable or silent, but HadeethEnc (authentic-only collection) has it
  if ((h.status === 'unavailable' || h.status === 'not_found') && heFound) {
    return { ...out, status: he.status, kind: 'hadith', hadith: h, hadeethenc: he, paths };
  }
  return { ...out, status: h.status, kind: 'hadith', hadith: h, hadeethenc: heFound ? he : null, paths };
}

export async function checkText(text) {
  const claims = extractClaims(text);
  const results = [];
  for (const c of claims) results.push(await checkClaim(c)); // sequential: gentle on Dorar
  const summary = results.reduce((s, r) => ({ ...s, [r.status]: (s[r.status] || 0) + 1 }), {});
  return { claims: results, summary, total: results.length };
}
