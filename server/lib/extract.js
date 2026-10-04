// Rule-based claim extraction from Arabic da'wah text.
// Finds quoted Quran verses and hadiths by their usual markers, and keeps
// the position of each claim so the report can point back to the text.

const PBUH = '(?:\\s*(?:ﷺ|صلى\\s*الله\\s*عليه\\s*وسلم|صلّى\\s*الله\\s*عليه\\s*وسلّم|عليه\\s*الصلاة\\s*والسلام|عليه\\s*السلام))?';
const PROPHET = `(?:رسول\\s*الله|النبي|النبيّ|الرسول|المصطفى|الحبيب)${PBUH}`;
const ALLAH = '(?:الله\\s*)?(?:تعالى|عز\\s*وجل|عزّ\\s*وجلّ|سبحانه(?:\\s*وتعالى)?|جل\\s*وعلا|جلّ\\s*وعلا)';

const QUOTED = '(?:«([^»]{3,600})»|"([^"]{3,600})"|“([^”]{3,600})”|﴿([^﴾]{3,600})﴾|\\{([^}]{3,600})\\})';
const UNTIL_END = '([^.؟!\\n«»"“”]{6,400})';

const PATTERNS = [
  // explicit Quran brackets
  { type: 'quran', re: /﴿([^﴾]{3,800})﴾/g },
  { type: 'quran', re: /\{([^}]{3,800})\}/g },
  // "قال تعالى: ..." / "يقول الله عز وجل: ..."
  { type: 'quran', re: new RegExp(`(?:قال|يقول|وقال|ويقول|قول|قوله)\\s*(?:الله\\s*)?${ALLAH}\\s*[:：]?\\s*(?:${QUOTED}|${UNTIL_END})`, 'g') },
  // "قال رسول الله ﷺ: ..." / "أن النبي ﷺ قال: ..."
  { type: 'hadith', re: new RegExp(`(?:قال|يقول|وقال|ويقول|قول|عن)\\s*${PROPHET}\\s*(?:قال|أنه\\s*قال)?\\s*[:：]?\\s*(?:${QUOTED}|${UNTIL_END})`, 'g') },
  { type: 'hadith', re: new RegExp(`${PROPHET}\\s*(?:قال|يقول)\\s*[:：]?\\s*(?:${QUOTED}|${UNTIL_END})`, 'g') },
  // "في الحديث: ..." / "جاء في الحديث ..."
  { type: 'hadith', re: new RegExp(`(?:في|جاء\\s*في|ورد\\s*في|وفي)\\s*(?:الحديث|الأثر)(?:\\s*الشريف)?\\s*[:：]?\\s*(?:${QUOTED}|${UNTIL_END})`, 'g') },
  // any other quotation of 3+ words: type unknown, checked against both
  { type: 'unknown', re: /«([^»]{3,600})»|"([^"]{3,600})"|“([^”]{3,600})”/g },
];

const clean = (s) => s.replace(/^[\s:،,.\-–—"«»“”()]+|[\s:،,.\-–—"«»“”()]+$/g, '').trim();
const words = (s) => s.split(/\s+/).filter(Boolean).length;

export function extractClaims(text, { max = 12 } = {}) {
  const src = String(text || '');
  const claims = [];
  const taken = []; // [start, end] ranges already claimed

  for (const { type, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const quote = m.slice(1).find((g) => g);
      if (!quote) continue;
      const q = clean(quote);
      if (words(q) < 3) continue;
      const start = src.indexOf(quote, m.index);
      const end = start + quote.length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);
      claims.push({ type, text: q, start, end });
    }
  }
  return claims.sort((a, b) => a.start - b.start).slice(0, max);
}
