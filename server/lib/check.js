// Full pipeline: text → claims → verification → report with the five JIHBATH statuses.
import { extractClaims } from './extract.js';
import { detectReferrals } from './scope.js';
import { verifyQuran, ayahByRef, findUnmarkedAyahs } from './quran.js';
import { verifyQuranEnglish } from './quranenc.js';
import { verifyHadith } from './hadith.js';
import { verifyHadeethEnc, verifyByMeaning, findUnmarkedHadiths } from './hadeethenc.js';

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
  const firstQuran = first.split(' ').length >= 2 ? verifyQuran(first) : null;
  return { part, first, firstQuran, quran: other };
}

// Ayahs from different places joined so loosely that none matches the whole quote
// («ومنهم من يعبد الله على حرف ولم يكن له كفوا احد»), two, three or four of them: the quote is
// cut into segments of 3+ words, each found on its own, consecutive ones in different places.
function splitMerge(text) {
  const words = String(text).trim().split(/\s+/);
  const n = words.length;
  if (n < 6 || n > 40) return null;
  const cache = new Map();
  const seg = (i, j) => {
    const k = `${i}:${j}`;
    if (!cache.has(k)) {
      const r = verifyQuran(words.slice(i, j).join(' '));
      cache.set(k, r.status !== 'not_found' && r.status !== 'too_short' && r.coverage >= 0.75 ? r : null);
    }
    return cache.get(k);
  };
  const sameAyah = (a, b) => a.ref.surah === b.ref.surah && a.ref.from <= b.ref.to && b.ref.from <= a.ref.to;
  // best[j] = best segmentation of words[0..j)
  const best = new Array(n + 1).fill(null);
  best[0] = { score: 0, parts: [] };
  for (let j = 3; j <= n; j++) {
    for (let i = Math.max(0, j - 40); i <= j - 3; i++) {
      const prev = best[i];
      if (!prev || prev.parts.length >= 4) continue;
      const r = seg(i, j);
      if (!r) continue;
      const last = prev.parts[prev.parts.length - 1];
      if (last && sameAyah(last.quran, r)) continue;
      const score = prev.score + r.coverage * (j - i) - 0.5; // fewer segments preferred
      if (!best[j] || score > best[j].score) best[j] = { score, parts: [...prev.parts, { text: words.slice(i, j).join(' '), quran: r }] };
    }
  }
  const res = best[n];
  if (!res || res.parts.length < 2) return null;
  const [first, ...rest] = res.parts;
  return {
    parts: res.parts,
    first: first.text, firstQuran: first.quran,
    part: rest.map((p) => p.text).join(' '), quran: rest[rest.length - 1].quran,
  };
}

async function hadithOrUnavailable(text) {
  try { return await verifyHadith(text); }
  catch (e) { return { status: 'unavailable', error: e.message }; }
}

async function checkClaim(claim) {
  const out = { ...claim };

  // Translated (English) claim: first the official translations of the Quran (QuranEnc),
  // then HadeethEnc's official hadith translations
  if (!/[\u0600-\u06FF]/.test(claim.text)) {
    const qe = verifyQuranEnglish(claim.text);
    const qeFound = (qe.status === 'exact' || qe.status === 'variant') && (claim.type === 'quran' || qe.coverage >= 0.85);
    if (qeFound) {
      const ar = ayahByRef(qe.surah, qe.ayah);
      const quran = { ref: ar?.ref, text: ar?.text, ops: qe.ops, translation: qe.translation };
      if (claim.type === 'hadith') {
        return { ...out, status: 'variant', kind: 'quran', translated: true, misattributed: true, note: 'هذه ترجمة آية من القرآن الكريم، وليست حديثًا', quran };
      }
      return { ...out, status: qe.status, kind: 'quran', translated: true, quran };
    }
    const he = verifyHadeethEnc(claim.text);
    // 1) the quote follows HadeethEnc's own translation word for word
    if (he.status === 'exact' || he.status === 'variant') return { ...out, status: he.status, kind: 'hadith', translated: true, hadeethenc: he };
    // 2) agreed design: translated text is matched by MEANING
    const m = await verifyByMeaning(claim.text);
    // Per the shari'a mentor: a meaning match must not merge "the hadith is established" with
    // "this translation is accurate". The original's grade is shown from its source; whether the
    // English wording is a faithful rendering is left to a qualified reviewer.
    if (m.status === 'meaning' || m.status === 'meaning_possible') {
      return { ...out, status: 'review', kind: 'hadith', translated: true, meaning: true, closeness: m.status === 'meaning' ? 'high' : 'medium', hadeethenc: m,
        note: m.status === 'meaning'
          ? 'النص الإنجليزي ترجمة لمعنى الحديث أدناه بحسب التشابه، والحكم المعروض حكم الأصل العربي من مصدره؛ أما دقة هذه الترجمة فتحتاج مراجعًا مؤهلًا.'
          : 'قريب في المعنى من الحديث أدناه دون جزم بأنه هو؛ قد يكون قولًا آخر يشبهه. والحكم المعروض حكم الأصل العربي من مصدره.' };
    }
    if (he.status === 'initializing' || m.status === 'initializing') {
      return { ...out, status: 'unavailable', kind: 'hadith', translated: true, note: 'موسوعة الأحاديث النبوية قيد التهيئة على الخادم؛ أعد المحاولة لاحقًا' };
    }
    return { ...out, status: 'not_found', kind: 'hadith', translated: true, hadeethenc: he };
  }


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
    const split = splitMerge(claim.text);
    if (split) {
      const quran = { ...split.firstQuran, ops: split.parts.flatMap((p) => p.quran.ops || []) };
      const count = split.parts.length === 2 ? 'آيتان' : `${split.parts.length} آيات`;
      return { ...out, status: 'variant', kind: 'quran', merged: split, quran,
        note: `دُمجت هنا ${count} من مواضع مختلفة في اقتباس واحد` };
    }
    // Not an ayah — is it a hadith quoted as Quran («يقول الله تعالى: من اقتطع حق امرئ مسلم…»)?
    // Then it is judged as the hadith it is, and the wrong attribution is flagged.
    const h = await hadithOrUnavailable(claim.text);
    if (['exact', 'variant', 'weak', 'review'].includes(h.status)) {
      const he = verifyHadeethEnc(claim.text);
      const heFound = he.status === 'exact' || he.status === 'variant';
      const heSahihayn = heFound && /البخاري|مسلم|متفق عليه/.test(String(he.attribution || ''));
      let status = h.status, basis = h.basis;
      if (h.status === 'review' && h.basis === 'disputed' && heSahihayn) {
        status = (h.lead?.ops || []).every((o) => o.type === 'equal') ? 'exact' : 'variant';
        basis = 'sahihayn_he';
      }
      return { ...out, status, basis, kind: 'hadith', misattributed: true, quotedAsAyah: true, hadith: h, hadeethenc: heFound ? he : null,
        note: 'نُسب إلى القرآن، وليس آية؛ وهو حديث، وحكمه منقول أدناه من مصادره' };
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

  // Two independent paths: Dorar (live, chain-level verdicts) and HadeethEnc (local index)
  const [h, he] = [await hadithOrUnavailable(claim.text), verifyHadeethEnc(claim.text)];
  const heFound = he.status === 'exact' || he.status === 'variant';
  const paths = [h.status !== 'not_found' && h.status !== 'unavailable', heFound].filter(Boolean).length;
  if (claim.athar) {
    // a companion's saying: looked up the same way, but never presented as the Prophet's words
    return { ...out, status: h.status === 'not_found' ? 'not_found' : 'review', kind: 'hadith', athar: true, hadith: h, hadeethenc: null, paths, basis: h.basis,
      note: 'هذا قول صحابي (أثر)، لا حديث مرفوع إلى النبي ﷺ؛ والحكم المعروض لأقرب رواية وُجدت، ويُراجع فيه مختص.' };
  }

  // Not found by wording anywhere: preachers often narrate a hadith by its meaning. Look for it
  // by meaning — shown for review only, never as established, since a different saying can
  // resemble a hadith in meaning (the shari'a mentor's caution applies here too).
  if ((h.status === 'not_found' || h.status === 'unavailable') && !heFound) {
    const m = await verifyByMeaning(claim.text);
    if (m.status === 'meaning' || m.status === 'meaning_possible') {
      return { ...out, status: 'review', kind: 'hadith', meaning: true, arabicMeaning: true, hadith: h, hadeethenc: m,
        closeness: m.status === 'meaning' ? 'high' : 'medium',
        note: 'لم يُعثر على هذا اللفظ في المصادر، وهو قريب في معناه من الحديث أدناه؛ فقد يكون مرويًّا بالمعنى، وقد يكون قولًا آخر يشبهه. والفصل فيه لمختص.' };
    }
  }

  // Dorar unreachable or silent, but HadeethEnc (authentic-only collection) has it
  // HadeethEnc's own takhrij is a sourced fact: if it attributes the hadith to the Sahihayn,
  // that settles a case where Dorar's first results disagree (e.g. weak side-chains).
  const heSahihayn = heFound && /البخاري|مسلم|متفق عليه/.test(String(he.attribution || ''));
  if ((h.status === 'unavailable' || h.status === 'not_found') && heFound) {
    return { ...out, status: he.status, kind: 'hadith', hadith: h, hadeethenc: he, paths, basis: heSahihayn ? 'sahihayn_he' : 'hadeethenc' };
  }
  if (h.status === 'review' && h.basis === 'disputed' && heSahihayn) {
    const exact = (h.lead?.ops || []).every((o) => o.type === 'equal');
    return { ...out, status: exact ? 'exact' : 'variant', kind: 'hadith', hadith: h, hadeethenc: he, paths, basis: 'sahihayn_he' };
  }
  return { ...out, status: h.status, kind: 'hadith', hadith: h, hadeethenc: heFound ? he : null, paths, basis: h.basis };
}

export async function checkText(text) {
  const claims = extractClaims(text);
  // quotations written into the text with no marker at all
  const span = (arr) => arr.map((c) => [c.start, c.end]);
  const ayahs = findUnmarkedAyahs(text, span(claims));
  const hadiths = findUnmarkedHadiths(text, span([...claims, ...ayahs]));
  claims.push(...[...ayahs, ...hadiths].slice(0, Math.max(0, 20 - claims.length)));
  claims.sort((a, b) => a.start - b.start);
  const referrals = detectReferrals(text);
  const results = [];
  for (const c of claims) results.push(await checkClaim(c)); // sequential: gentle on Dorar
  // Level (د): referred, never answered; kept in reading order with the claims
  results.push(...referrals.filter((r) => !claims.some((c) => r.start >= c.start && r.end <= c.end)));
  results.sort((a, b) => a.start - b.start);
  const summary = results.reduce((s, r) => ({ ...s, [r.status]: (s[r.status] || 0) + 1 }), {});
  return { claims: results, summary, total: results.length };
}
