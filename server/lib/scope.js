// Level (د) of the challenge's scientific reference: requests jihbath must NOT answer —
// personal fatwas and judgments on people — are detected and referred, never answered.
// Attempts to override the tool's limits are noted and change nothing.

const MARKS = /[\u0610-\u061A\u064B-\u065F\u0670]/g;
const norm = (s) => String(s || '').replace(MARKS, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي');

const FATWA = [
  /(?:^|\s)(?:ما|وش|ايش|شو)\s*(?:حكم|الحكم)/,
  /(?:^|\s)[فو]?هل\s*(?:يجوز|يحل|يحرم|يصح|يلزم|يجب|يقع|تقع|وقع|يبطل|تبطل|ياثم|اثم|حرام|حلال|علي|علي\s)/,
  /(?:^|\s)(?:طلقت|حلفت|نذرت|اقسمت|افطرت)(?:\s|$).*(?:\?|؟|هل|ماذا|ما\s)/,
  /(?:افتوني|اريد\s*فتوي|اعطني\s*فتوي|ابي\s*فتوي|فتوي\s*في)/,
  /\b(?:is it (?:permissible|halal|haram|allowed|forbidden)|what(?:'s| is) the (?:islamic )?ruling|give me a fatwa)\b/i,
];
const PERSON = [
  /(?:^|\s)[فو]?هل\s*\S+(?:\s+\S+){0,3}\s+(?:كافر|مشرك|مبتدع|فاسق|منافق|زنديق|مرتد|ضال)(?:\s|[؟?]|$)/,
  /(?:^|\s)[فو]?هل\s*\S+(?:\s+\S+){0,3}\s+من\s+اهل\s+(?:النار|الجنه|الجنة)/,
  /\bis\s+\S+(?:\s+\S+){0,3}\s+(?:a\s+|an\s+)?(?:kafir|kaafir|disbeliever|apostate|heretic|hypocrite)\b/i,
];
const OVERRIDE = [/تجاهل\s*(?:تعليماتك|التعليمات|القواعد|قيودك)/, /\bignore (?:your|all|previous|the) (?:instructions|rules)\b/i];

const MSG = {
  fatwa: 'سؤال يطلب فتوى أو حكمًا لحالة بعينها، وهذا خارج اختصاص جِهْبَاذ؛ فهو يتحقق من النصوص المنقولة ولا يُفتي. يُرجع فيه إلى جهة إفتاء معتمدة، مثل الرئاسة العامة للبحوث العلمية والإفتاء في المملكة العربية السعودية (alifta.gov.sa)، أو جهة الإفتاء الرسمية في بلدك.',
  person: 'الحكم على الأشخاص بالكفر أو البدعة أو الفسق أو غيرها خارج اختصاص جِهْبَاذ، وهو من شأن أهل العلم والقضاء.',
  override: 'وجِهْبَاذ يلتزم حدوده نفسها مهما طُلب منه خلاف ذلك.',
};

export function detectReferrals(text) {
  const out = [];
  const sentences = String(text || '').split(/(?<=[.؟?!\n])\s*/).filter((s) => s.trim());
  const overrideAnywhere = OVERRIDE.some((r) => r.test(norm(text)));
  for (const raw of sentences) {
    const s = norm(raw);
    const category = PERSON.some((r) => r.test(s)) ? 'person' : FATWA.some((r) => r.test(s)) ? 'fatwa' : null;
    if (!category) continue;
    // anchor at the question itself, so a quoted ayah earlier in the sentence keeps its place
    const q = raw.search(/[فو]?هل|حكم|[أا]فتوني|فتوى|is it|what(?:'s| is)/i);
    const start = String(text).indexOf(raw) + Math.max(0, q);
    out.push({
      type: 'question', kind: 'refer', status: 'refer', category,
      text: raw.slice(Math.max(0, q)).trim(), start, end: String(text).indexOf(raw) + raw.length,
      note: MSG[category] + (overrideAnywhere ? ' ' + MSG.override : ''),
    });
  }
  // An override attempt with no question attached is still answered with the same limits
  if (!out.length && overrideAnywhere) {
    out.push({ type: 'question', kind: 'refer', status: 'refer', category: 'override', text: String(text).trim().slice(0, 200), start: 0, end: 0, note: 'لا يمكن تغيير حدود جِهْبَاذ: يتحقق من الآيات والأحاديث المنقولة، ولا يُفتي ولا يحكم على الأشخاص. ' + MSG.fatwa });
  }
  return out;
}
