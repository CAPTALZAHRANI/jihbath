// «النص الموثَّق»: the user's own text, ready to publish — corrections placed where they
// belong and short citations in brackets, nothing else. Nothing is generated and nothing
// is deleted: Quran wording is replaced with the mushaf's (it is fixed text); a hadith whose
// wording differs takes the narration's wording; anything not established is kept as the
// author wrote it and only marked, with the scholar's verdict quoted.

const CLOSERS = '﴾»"”)}';
const OPENERS = '﴿«"“({';
// Quote marks are often separated from the words by a space (` " من اقتطع … حق " `)
function openerBefore(text, start) {
  let i = start;
  while (i > 0 && text[i - 1] === ' ') i--;
  return OPENERS.includes(text[i - 1] || '') && text[i - 1] ? i - 1 : start;
}
function closerAfter(text, end) {
  let i = end;
  while (i < text.length && text[i] === ' ') i++;
  if (!(CLOSERS.includes(text[i] || '') && text[i])) return end;
  while (i < text.length && CLOSERS.includes(text[i])) i++;
  return i;
}

const surahShort = (name) => String(name || '').replace(/^سورة\s+/, '');
const ayahRef = (r) => r ? `${surahShort(r.surahName)}: ${r.from === r.to ? r.from : `${r.from}–${r.to}`}` : '';

// The source's own words for the quoted span (from the word alignment)
const sourceWords = (ops) => (ops || []).flatMap((o) => (o.type === 'added' ? [] : o.source)).join(' ');

function sahihaynCitation(c) {
  const lead = c.hadith?.lead, also = c.hadith?.alsoIn, he = c.hadeethenc;
  const t = String(he?.attribution || '');
  if (/متفق عليه/.test(t) || (/البخاري/.test(t) && /مسلم/.test(t))) return 'متفق عليه';
  if (lead?.sahihayn) return `رواه ${/مسلم/.test(lead.source) ? 'مسلم' : 'البخاري'}`;
  if (also) return `وأصله في ${also.source}`;
  if (/البخاري/.test(t)) return 'رواه البخاري';
  if (/مسلم/.test(t)) return 'رواه مسلم';
  return '';
}

function rewrite(c) {
  const en = c.translated;
  if (c.kind === 'refer') return { note: 'يُحال إلى جهة إفتاء معتمدة' };
  if (c.status === 'not_found') return { note: en ? '⚠ not found in the approved sources' : '⚠ لم يُعثر عليه في المصادر المعتمدة' };
  if (c.status === 'unavailable') return { note: '⚠ تعذّر التحقق الآن' };

  if (c.kind === 'quran') {
    const ref = ayahRef(c.quran?.ref);
    if (en) return { note: `Qur'an ${c.quran?.ref?.surah}:${c.quran?.ref?.from}${c.misattributed ? ' — a verse, not a hadith' : ''}` };
    if (c.merged) return { note: `${ref}، و${ayahRef(c.merged.quran?.ref)} — آيتان من موضعين` };
    const words = sourceWords(c.quran?.ops);
    return { text: words || null, note: c.misattributed ? `آية: ${ref}، وليست حديثًا` : ref };
  }

  // hadith
  const verdict = (m) => m ? `«${String(m.grade || '').replace(/^\[(.*)\]$/, '$1')}» — ${m.muhaddith || ''}`.trim() : '';
  switch (c.basis) {
    case 'sahihayn':
    case 'sahihayn_he': {
      const words = c.status === 'variant' ? sourceWords(c.hadith?.lead?.ops) : null;
      // a hadith has several narrations: the author's wording is never replaced
      return { note: `${sahihaynCitation(c)}${words ? `، وفي روايته: «${words}»` : ''}` };
    }
    case 'graded_authentic': {
      const l = c.hadith?.lead;
      const words = c.status === 'variant' ? sourceWords(l?.ops) : null;
      return { note: `${l?.source || ''}، ${verdict(l)}${words ? `، وفي روايته: «${words}»` : ''}` };
    }
    case 'hadeethenc':
      return { note: sahihaynCitation(c) || 'موسوعة الأحاديث النبوية' };
    case 'graded_weak':
      return { note: `⚠ نُقل تضعيفه: ${verdict(c.hadith?.lead)}` };
    case 'graded_fabricated':
      return { note: `⚠ نُقل الحكم بوضعه: ${verdict(c.hadith?.lead)}` };
    case 'disputed':
      return { note: '⚠ اختلفت أحكام العلماء فيه: يُراجع مختص' };
    default:
      if (c.arabicMeaning) return { note: '⚠ لم يُعثر على لفظه، وهو قريب في معناه من حديث في موسوعة الأحاديث النبوية: يُراجع مختص' };
      if (c.meaning) return { note: '⚠ meaning resembles a hadith; the translation needs review' };
      return { note: '⚠ يُراجع مختص' };
  }
}

// An ayah quoted as a hadith: the attribution itself is the error. The Quran is certain text,
// so the attribution is corrected ("قال تعالى") and the ayah put between ﴿ ﴾ with its place —
// and the author's original wording is kept in the note, so nothing is silently changed.
function fixMisattributedAyah(text, c) {
  if (c.kind !== 'quran' || !c.misattributed || c.translated || c.attrStart == null) return null;
  const open = openerBefore(text, c.start), close = closerAfter(text, c.end);
  let attrEnd = open;
  while (attrEnd > c.attrStart && /[\s:：]/.test(text[attrEnd - 1])) attrEnd--;
  const original = text.slice(c.attrStart, attrEnd).trim();
  const lead = /^و/.test(original) ? 'و' : '';
  const words = sourceWords(c.quran?.ops) || c.text;
  const replacement = `${lead}قال تعالى: ﴿${words}﴾ [${ayahRef(c.quran?.ref)} — صُحّحت النسبة، وكان في الأصل: «${original}»]`;
  return { from: c.attrStart, to: close, replacement, at: null, note: null };
}

// Two ayahs fused into one quote are written back as two ayahs, each in the mushaf's wording
// and with its own place, instead of one quote with a note.
function splitMergedAyahs(text, c) {
  if (c.kind !== 'quran' || !c.merged || c.translated) return null;
  const parts = c.merged.parts || [
    { text: c.merged.first, quran: c.merged.firstQuran || c.quran },
    { text: c.merged.part, quran: c.merged.quran },
  ];
  const from = openerBefore(text, c.start), to = closerAfter(text, c.end);
  const replacement = parts.map((p) => `﴿${sourceWords(p.quran?.ops) || p.text}﴾ [${ayahRef(p.quran?.ref)}]`).join('، ');
  return { from, to, replacement, at: null, note: null };
}

// A hadith quoted as an ayah («يقول الله تعالى: من اقتطع…»). Established: the attribution is
// corrected to the Prophet ﷺ, with the original kept in the note. Otherwise the author's words
// stay, marked as a hadith (not an ayah) with what was reported about it.
const BASIS_NOTE = {
  graded_weak: 'نُقل تضعيفه', graded_fabricated: 'نُقل الحكم بوضعه', disputed: 'اختلفت فيه أحكام العلماء',
  isnad_only: 'نُقل تصحيح إسناده فقط', not_explicit: 'حكمه غير صريح',
};
function fixHadithQuotedAsAyah(text, c) {
  if (!c.quotedAsAyah) return null;
  const established = ['exact', 'variant'].includes(c.status) && ['sahihayn', 'sahihayn_he', 'graded_authentic', 'hadeethenc'].includes(c.basis);
  const at = closerAfter(text, c.end);
  if (!established || c.attrStart == null) {
    return { from: c.start, to: c.start, replacement: null, at, note: `⚠ ليس آية، بل حديث${BASIS_NOTE[c.basis] ? `: ${BASIS_NOTE[c.basis]}` : ''} — يُراجع مختص` };
  }
  const open = openerBefore(text, c.start);
  let attrEnd = open;
  while (attrEnd > c.attrStart && /[\s:：]/.test(text[attrEnd - 1])) attrEnd--;
  const original = text.slice(c.attrStart, attrEnd).trim();
  const lead = /^و/.test(original) ? 'و' : '';
  const l = c.hadith?.lead;
  const words = c.status === 'variant' ? sourceWords(l?.ops) : null;
  const body = text.slice(c.start, c.end).trim(); // the author's wording stays
  const close = closerAfter(text, c.end);
  const verdictOf = (m) => m ? `«${String(m.grade || '').replace(/^\[(.*)\]$/, '$1')}» — ${m.muhaddith || ''}`.trim() : '';
  const cite = sahihaynCitation(c)
    || (c.basis === 'graded_authentic' && l ? `${l.source}، ${verdictOf(l)}` : '')
    || (c.basis === 'hadeethenc' ? 'موسوعة الأحاديث النبوية' : '');
  return { from: c.attrStart, to: close, at: null, note: null,
    replacement: `${lead}قال رسول الله ﷺ: «${body}» [${cite}${words ? `، وفي روايته: «${words}»` : ''} — صُحّحت النسبة، وكان في الأصل: «${original}»]` };
}

export function buildDocumented(source, claims) {
  const text = String(source || '');
  const edits = [];
  for (const c of claims || []) {
    if (c.start == null || c.end == null || c.end < c.start) continue;
    const fixed = fixMisattributedAyah(text, c) || splitMergedAyahs(text, c) || fixHadithQuotedAsAyah(text, c);
    if (fixed) { edits.push(fixed); continue; }
    const { text: replacement, note } = rewrite(c);
    let from = c.start, to = c.end, rep = replacement;
    // A Quran quote always ends up between ﴿ ﴾: other quote marks are swapped, none are added
    if (rep && c.kind === 'quran' && !c.translated && !c.merged) {
      const o = openerBefore(text, from), cl = closerAfter(text, to);
      if (o < from && text[o] === '﴿') { /* already ﴿ ﴾ */ }
      else if (o < from && cl > to) { from = o; to = cl; rep = `﴿${rep}﴾`; }
      else rep = `﴿${rep}﴾`;
    }
    const at = closerAfter(text, to); // cite after the closing bracket/quote
    edits.push({ from, to, replacement: rep, at, note });
  }
  edits.sort((a, b) => b.from - a.from); // apply from the end so offsets stay valid
  let out = text;
  for (const e of edits) {
    if (e.note) out = out.slice(0, e.at) + ` [${e.note}]` + out.slice(e.at);
    if (e.replacement) out = out.slice(0, e.from) + e.replacement + out.slice(e.to);
  }
  return out;
}
