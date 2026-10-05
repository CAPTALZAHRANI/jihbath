// Classifies a muhaddith's verdict text into a broad category.
// The verbatim verdict is ALWAYS shown to the user; this only drives the status badge.
// Order matters: "not about attribution" first, then negatives, then positives,
// so "ليس بصحيح" is never read as "صحيح" and "معناه صحيح" never as an authentic hadith.

export function cleanGrade(text) {
  return String(text || '')
    .replace(/-{3,}/g, ' ')
    .replace(/\s*المزيد\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Verdicts that do not establish the wording as a Prophetic hadith
const NOT_ATTRIBUTION = [/معناه\s*صحيح/, /موقوف/, /مقطوع/, /من\s*قول/];

// "إسناده صحيح" judges the chain, not the hadith (a sound chain can still carry shudhudh or
// an 'illah) — kept as its own category and never turned into "authentic hadith".
const ISNAD = [/(?:^|\s|\[)(?:إسناده|اسناده|سنده|إسناد)\s*(?:صحيح|حسن|جيد|قوي|ثابت)/, /رجاله\s*(?:ثقات|رجال\s*الصحيح)/];

// Explicit fabrication only. "لا أصل له" and "باطل" depend on each scholar's usage and context,
// so they stay with the general "weak" family; the verbatim verdict is always shown.
const FABRICATED = [/(^|[\s\[«(])موضوعٌ?(?=$|[\s\]».،:؛)])/, /مكذوب/, /(^|\s)كذب(\s|$)/];

const WEAK = [
  // any negated positive: غير صحيح، ليس بثابت، لا يصح، لم يثبت، ليس بحسن …
  /(غير|ليس\s*ب?|لا|لم|ما)\s*(ال)?(صحيح|ثابت|ثبت|حسن|يصح|يثبت|صح)/, /لا\s*[أا]صل\s*له/, /ليس\s*[^،.]{0,15}?[أا]صل/, /ليس\s*بحديث/,
  /لم\s*[أا]قف\s*عليه/, /لم\s*[أا]جده/, /لا\s*[أا]عرفه/,
  /باطل/, /منكر/, /ضعيف/, /(^|\s|\[)واهٍ?(\s|\]|$)/, /شاذ/, /مقلوب/, /متروك/, /خطأ/,
];
const STRONG = [/صحيح/, /حسن/, /متفق\s*عليه/, /ثابت/, /ثبت/, /جيد/];

export function classifyGrade(text) {
  const t = cleanGrade(text);
  if (!t) return 'unknown';
  if (NOT_ATTRIBUTION.some((r) => r.test(t))) return 'review';
  if (WEAK.some((r) => r.test(t))) return FABRICATED.some((r) => r.test(t)) ? 'fabricated' : 'weak';
  if (FABRICATED.some((r) => r.test(t))) return 'fabricated';
  if (ISNAD.some((r) => r.test(t))) return 'isnad';
  if (STRONG.some((r) => r.test(t))) return 'strong';
  return 'review';
}

// Only the two Sahih collections themselves — not commentaries such as "شرح البخاري".
export const isSahihayn = (source, muhaddith) =>
  /^صحيح\s+(البخاري|مسلم)$/.test(String(source || '').trim()) ||
  /^(البخاري|مسلم)$/.test(String(muhaddith || '').trim());
