// Rule-based claim extraction from Arabic da'wah text.
// Finds quoted Quran verses and hadiths by their usual markers, and keeps
// the position of each claim so the report can point back to the text.

const PBUH = '(?:\\s*(?:ﷺ|صلى\\s*الله\\s*عليه\\s*وسلم|صلّى\\s*الله\\s*عليه\\s*وسلّم|عليه\\s*الصلاة\\s*والسلام|عليه\\s*السلام))?';
const PROPHET = `(?:رسول\\s*الله|النبي|النبيّ|الرسول|المصطفى|الحبيب(?:\\s*المصطفى)?|نبينا(?:\\s*محمد)?|نبيّنا(?:\\s*محمد)?|رسولنا|سيد\\s*(?:الخلق|المرسلين|البشر|ولد\\s*آدم)|خير\\s*البرية|الهادي\\s*البشير)${PBUH}`;
// The Prophet ﷺ named only by the salawat: «قال عليه السلام: …»
const SALAWAT = '(?:ﷺ|صلى\\s*الله\\s*عليه\\s*وسلم|صلّى\\s*الله\\s*عليه\\s*وسلّم|عليه\\s*(?:أفضل\\s*)?(?:الصلاة\\s*و)?السلام)';
const GLORY = '(?:تعالى|(?:عز|عزّ|عزل)\\s*وجلّ?|سبحانه(?:\\s*وتعالى)?|جلّ?\\s*و(?:علا|على)|جلّ?\\s*جلاله|تبارك\\s*وتعالى|جلّ?\\s*شأنه)';
const NAMES = '(?:الله|الباري|ربنا|ربّنا|ربكم|ربك|المولى|الحق|الرحمن)';
// «قال تعالى» / «يقول الله» / «يقول الباري عز وجل» / «قال ربنا في كتابه الكريم» …
const ALLAH = `(?:${NAMES}(?:\\s*${GLORY})?|${GLORY})(?:\\s*في\\s*(?:كتابه(?:\\s*(?:الكريم|العزيز))?|محكم\\s*(?:التنزيل|كتابه)))?`;

const QUOTED = '(?:«([^»]{3,600})»|"([^"]{3,600})"|“([^”]{3,600})”|﴿([^﴾]{3,600})﴾|\\{([^}]{3,600})\\})';
const UNTIL_END = '([^.؟!\\n«»"“”]{6,400})';

const PATTERNS = [
  // explicit Quran brackets
  { type: 'quran', re: /﴿([^﴾]{3,800})﴾/g },
  { type: 'quran', re: /\{([^}]{3,800})\}/g },
  // "قال تعالى: ..." / "يقول الله عز وجل: ..."
  // Hadith qudsi first: «يقول الله في الحديث القدسي» is a hadith, not an ayah
  { type: 'hadith', attr: true, re: new RegExp(`(?:قال|يقول|وقال|ويقول)\\s*(?:${NAMES}(?:\\s*${GLORY})?|${GLORY})\\s*(?:في\\s*(?:ال)?حديث\\s*(?:ال)?قدسيّ?|فيما\\s*يرويه\\s*عنه\\s*(?:نبيه|رسوله)\\s*${SALAWAT}?)\\s*[:：]?\\s*(?:${QUOTED}|${UNTIL_END})`, 'g') },
  { type: 'quran', attr: true, re: new RegExp(`(?:قال|يقول|وقال|ويقول|قول|قوله)\\s*${ALLAH}\\s*[:：]?\\s*(?:${QUOTED}|${UNTIL_END})`, 'g') },
  // «قال عليه السلام: …» / «يقول ﷺ: …»
  { type: 'hadith', attr: true, re: new RegExp(`(?:قال|يقول|وقال|ويقول|وقوله|قوله)\\s*${SALAWAT}\\s*[:：]?\\s*(?:${QUOTED}|${UNTIL_END})`, 'g') },
  // "قال رسول الله ﷺ: ..." / "أن النبي ﷺ قال: ..."
  { type: 'hadith', attr: true, re: new RegExp(`(?:قال|يقول|وقال|ويقول|قول|عن)\\s*${PROPHET}\\s*(?:قال|أنه\\s*قال)?\\s*[:：]?\\s*(?:${QUOTED}|${UNTIL_END})`, 'g') },
  { type: 'hadith', attr: true, re: new RegExp(`${PROPHET}\\s*(?:قال|يقول)\\s*[:：]?\\s*(?:${QUOTED}|${UNTIL_END})`, 'g') },
  // Robust to a mistyped title ("قال رسوم الله ﷺ"): the salawat itself followed by a colon
  { type: 'hadith', attr: true, re: new RegExp(`(?:ﷺ|صلى\\s*الله\\s*عليه\\s*وسلم|صلّى\\s*الله\\s*عليه\\s*وسلّم)\\s*(?:قال|يقول|أنه\\s*قال)?\\s*[:：]\\s*(?:${QUOTED}|${UNTIL_END})`, 'g') },
  // "في الحديث: ..." / "جاء في الحديث ..."
  { type: 'hadith', re: new RegExp(`(?:في|جاء\\s*في|ورد\\s*في|وفي)\\s*(?:الحديث|الأثر)(?:\\s*الشريف)?\\s*[:：]?\\s*(?:${QUOTED}|${UNTIL_END})`, 'g') },
  // English Quran: "Allah says: ..." / "The Quran says ..."
  { type: 'quran', re: /(?:(?:Allah|God)(?:\s*\((?:SWT|swt|the Exalted|Exalted|Glorified|subhanahu wa ta'ala)\))?\s+(?:says|said|states)(?:\s+in\s+(?:the\s+)?(?:Holy\s+)?(?:Quran|Qur'an|Qur’an))?|(?:the\s+)?(?:Holy\s+)?(?:Quran|Qur'an|Qur’an)\s+(?:says|states))\s*[:,]?\s*(?:"([^"]{3,600})"|“([^”]{3,600})”|["“]?([^."“”\n]{6,400}))/gi },
  // English: "The Prophet (ﷺ) said: ..." / "Allah's Messenger said ..."
  { type: 'hadith', re: /(?:the\s+)?(?:Prophet(?:\s+Muhammad)?|Messenger\s+of\s+(?:Allah|God)|Allah's\s+Messenger)(?:\s*\((?:ﷺ|peace be upon him|pbuh|saw)\)|\s*ﷺ|,?\s*peace be upon him,?)?\s+(?:said|says|stated)\s*[:,]?\s*(?:"([^"]{3,600})"|“([^”]{3,600})”|["“]?([^."“”\n]{6,400}))/gi },
  // any other quotation of 3+ words: type unknown, checked against both
  { type: 'unknown', re: /«([^»]{3,600})»|"([^"]{3,600})"|“([^”]{3,600})”/g },
];

const clean = (s) => s.replace(/^[\s:،,.\-–—"«»“”()]+|[\s:،,.\-–—"«»“”()]+$/g, '').trim();
const words = (s) => s.split(/\s+/).filter(Boolean).length;

export function extractClaims(text, { max = 12 } = {}) {
  const src = String(text || '');
  const claims = [];
  const taken = []; // [start, end] ranges already claimed

  for (const { type, re, attr } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const quote = m.slice(1).find((g) => g);
      if (!quote) continue;
      const q = clean(quote);
      // explicitly attributed quotes may be very short («الدين النصيحة»); bare quotes need 3+ words
      if (words(q) < (type === 'unknown' ? 3 : 2)) continue;
      const start = src.indexOf(quote, m.index);
      const end = start + quote.length;
      // The whole match counts — attribution phrase included. Otherwise a later pattern can
      // re-read part of an earlier attribution as a quote: after «قال جل وعلا في الحديث القدسي
      // "…"» was taken as a hadith qudsi, the Quran pattern took «في الحديث القدسي» as an ayah.
      const mStart = m.index, mEnd = m.index + m[0].length;
      if (taken.some(([a, b]) => mStart < b && mEnd > a)) continue;
      taken.push([mStart, mEnd]);
      claims.push({ type, text: q, start, end, ...(attr ? { attrStart: m.index } : {}) });
    }
  }
  return claims.sort((a, b) => a.start - b.start).slice(0, max);
}
