// «النص الموثَّق»: the user's own text, ready to publish — corrections placed where they
// belong and short citations in brackets, nothing else. Nothing is generated and nothing
// is deleted: Quran wording is replaced with the mushaf's (it is fixed text); a hadith whose
// wording differs takes the narration's wording; anything not established is kept as the
// author wrote it and only marked, with the scholar's verdict quoted.

const CLOSERS = '﴾»"”)}';
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
      return { text: words, note: sahihaynCitation(c) };
    }
    case 'graded_authentic': {
      const l = c.hadith?.lead;
      const words = c.status === 'variant' ? sourceWords(l?.ops) : null;
      return { text: words, note: `${l?.source || ''}، ${verdict(l)}` };
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
      if (c.meaning) return { note: '⚠ meaning resembles a hadith; the translation needs review' };
      return { note: '⚠ يُراجع مختص' };
  }
}

// An ayah quoted as a hadith: the attribution itself is the error. The Quran is certain text,
// so the attribution is corrected ("قال تعالى") and the ayah put between ﴿ ﴾ with its place —
// and the author's original wording is kept in the note, so nothing is silently changed.
function fixMisattributedAyah(text, c) {
  if (c.kind !== 'quran' || !c.misattributed || c.translated || c.attrStart == null) return null;
  let open = c.start, close = c.end;
  if ('«"“'.includes(text[open - 1] || '')) open--;
  if ('»"”'.includes(text[close] || '')) close++;
  let attrEnd = open;
  while (attrEnd > c.attrStart && /[\s:：]/.test(text[attrEnd - 1])) attrEnd--;
  const original = text.slice(c.attrStart, attrEnd).trim();
  const lead = /^و/.test(original) ? 'و' : '';
  const words = sourceWords(c.quran?.ops) || c.text;
  const replacement = `${lead}قال تعالى: ﴿${words}﴾ [${ayahRef(c.quran?.ref)} — صُحّحت النسبة، وكان في الأصل: «${original}»]`;
  return { from: c.attrStart, to: close, replacement, at: null, note: null };
}

export function buildDocumented(source, claims) {
  const text = String(source || '');
  const edits = [];
  for (const c of claims || []) {
    if (c.start == null || c.end == null || c.end < c.start) continue;
    const fixed = fixMisattributedAyah(text, c);
    if (fixed) { edits.push(fixed); continue; }
    const { text: replacement, note } = rewrite(c);
    let at = c.end;
    while (at < text.length && CLOSERS.includes(text[at])) at++; // cite after the closing bracket/quote
    edits.push({ from: c.start, to: c.end, replacement, at, note });
  }
  edits.sort((a, b) => b.from - a.from); // apply from the end so offsets stay valid
  let out = text;
  for (const e of edits) {
    if (e.note) out = out.slice(0, e.at) + ` [${e.note}]` + out.slice(e.at);
    if (e.replacement) out = out.slice(0, e.from) + e.replacement + out.slice(e.to);
  }
  return out;
}
