// Real published texts, compared with today's practice: for every quotation jihbath finds,
// what does a direct search on Dorar (pasting the quote as written) return?
//   files:   doc/real-texts/*.txt   — header lines «المصدر: …» and «النوع: …», then «---», then the text
//   run:     node scripts/real-texts.js     → doc/real-texts-results.md
import fs from 'node:fs';
import path from 'node:path';
import { loadQuran } from '../server/lib/quran.js';
import { loadQuranEnc } from '../server/lib/quranenc.js';
import { loadHadeethEnc } from '../server/lib/hadeethenc.js';
import { checkText } from '../server/lib/check.js';
import { searchDorar } from '../server/lib/dorar.js';

const DIR = 'doc/real-texts';
const LABEL = { exact: 'مطابق لمصدره', variant: 'وُجد بلفظ مختلف', weak: 'نُقل تضعيفه', not_found: 'لم يُعثر عليه', review: 'يحتاج مراجعة مختص', refer: 'يُحال', unavailable: 'تعذّر' };
const issue = (c) => c.status !== 'exact' || c.merged || c.misattributed;

loadQuran(); loadQuranEnc(); loadHadeethEnc();
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.txt')).sort();
if (!files.length) { console.error(`no texts in ${DIR}`); process.exit(1); }

let md = `# جِهْبَاذ على نصوص حقيقية منشورة\n\nتاريخ التشغيل: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} (UTC) · الأمر: \`node scripts/real-texts.js\`\n\n`;
md += 'المقارنة مع الممارسة الحالية: لكل اقتباس، ماذا يُرجع **البحث المباشر في الدرر السنية** عن الاقتباس كما كتبه الكاتب؟ (عدد النتائج، وحكم أول نتيجة).\n\n';
const total = { texts: 0, claims: 0, issues: 0, unmarked: 0, quran: 0, dorarNone: 0, issuesDorarNone: 0 };

for (const f of files) {
  const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
  const [head, ...body] = raw.split(/^---\s*$/m);
  const text = body.join('---').trim();
  const source = (head.match(/المصدر:\s*(.+)/) || [])[1]?.trim() || '';
  const kind = (head.match(/النوع:\s*(.+)/) || [])[1]?.trim() || '';
  const r = await checkText(text);
  total.texts++;
  md += `## ${f.replace(/\.txt$/, '')}${kind ? ` — ${kind}` : ''}\n\nالمصدر: ${source || '—'} · ${text.split(/\s+/).length} كلمة · ${r.claims.length} ادعاء\n\n`;
  md += '| # | الاقتباس | النوع | جِهْبَاذ | البحث المباشر في الدرر |\n| --- | --- | --- | --- | --- |\n';
  let i = 0;
  for (const c of r.claims) {
    i++; total.claims++;
    if (c.unmarked) total.unmarked++;
    if (c.kind === 'quran') total.quran++;
    const isIssue = issue(c);
    if (isIssue) total.issues++;
    let dorar = '—';
    if (c.kind !== 'refer') {
      try {
        const d = await searchDorar(c.text);
        const n = d.items.length;
        if (!n) { total.dorarNone++; if (isIssue) total.issuesDorarNone++; }
        dorar = n ? `${n} نتيجة · أولها: «${String(d.items[0].grade || '').slice(0, 40)}» — ${d.items[0].muhaddith || ''}` : '**لا نتيجة**';
      } catch (e) { dorar = `تعذّر (${e.message.slice(0, 30)})`; }
    }
    const kindLabel = c.kind === 'refer' ? 'سؤال' : `${c.kind === 'quran' ? 'آية' : 'حديث'}${c.unmarked ? ' دون علامة' : ''}`;
    const extra = [c.merged && 'آيات مدموجة', c.misattributed && 'نسبة خاطئة', c.arabicMeaning && 'بالمعنى'].filter(Boolean).join('، ');
    md += `| ${i} | ${String(c.text).slice(0, 70).replace(/\|/g, '/')} | ${kindLabel} | ${LABEL[c.status] || c.status}${extra ? ` (${extra})` : ''} | ${dorar} |\n`;
    process.stdout.write('.');
  }
  md += '\n';
}

md += `## الخلاصة\n\n| المؤشر | القيمة |\n| --- | --- |\n`;
md += `| النصوص | ${total.texts} |\n| الادعاءات التي استخرجها جِهْبَاذ | ${total.claims} |\n`;
md += `| منها آيات (البحث في الدرر لا يتحقق من الآيات أصلًا) | ${total.quran} |\n`;
md += `| منها مكتوبة دون أي علامة أو نسبة (يحتاج القارئ أن ينتبه لها بنفسه) | ${total.unmarked} |\n`;
md += `| ادعاءات فيها مشكلة كشفها جِهْبَاذ (لفظ مختلف، تضعيف، دمج، نسبة خاطئة، مراجعة، أو لم يُعثر عليه) | ${total.issues} |\n`;
md += `| منها لم يُرجع لها البحث المباشر في الدرر أي نتيجة | ${total.issuesDorarNone} |\n\n`;
md += `## حدود دلالة هذه النتائج\n\n- عدد النصوص صغير (${total.texts})، واختيرت يدويًا، فلا تُعمَّم نسبها على كل المحتوى الدعوي.\n- «البحث المباشر في الدرر» يمثل خطوة واحدة من التحقق اليدوي؛ المحقق الخبير يعيد صياغة البحث ويراجع المصحف وكتب التخريج، فيصل إلى أكثر مما تُظهره هذه المقارنة.\n- أحكام جِهْبَاذ منقولة من المصادر، ولم تُراجع نتائج هذه النصوص من مختص في علوم الحديث.\n`;
fs.writeFileSync('doc/real-texts-results.md', md);
console.log(`\n📄 doc/real-texts-results.md`);
console.log(total);
