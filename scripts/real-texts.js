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
import { tokenize } from '../server/lib/arabic.js';
import { lcsPairs } from '../server/lib/align.js';

const DIR = 'doc/real-texts';
const LABEL = { athar: 'قول صحابي', exact: 'مطابق لمصدره', variant: 'وُجد بلفظ مختلف', weak: 'نُقل تضعيفه', not_found: 'لم يُعثر عليه', review: 'يحتاج مراجعة مختص', refer: 'يُحال', unavailable: 'تعذّر' };
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
  if (text.split(/\s+/).length < 5) { console.log(`\n(skipped ${f}: empty)`); continue; }
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
        const first = d.items[0];
        // Dorar's search is fuzzy and nearly always returns results: what matters is whether the
        // first result is actually the quoted text (its words covered at least 80%)
        const qn = tokenize(c.text).norm;
        const cover = first ? lcsPairs(qn, tokenize(first.text).norm).length / Math.max(1, qn.length) : 0;
        const matches = cover >= 0.8;
        if (!matches) { total.dorarNone++; if (isIssue) total.issuesDorarNone++; }
        const grade = String(first?.grade || '').replace(/-{3,}/g, '').trim().slice(0, 40);
        dorar = !first ? '**لا نتيجة**' : `${matches ? 'أول نتيجة تطابق الاقتباس' : '**أول نتيجة لا تطابق الاقتباس**'} (${Math.round(cover * 100)}%) · حكمها: «${grade}» — ${first.muhaddith || ''}`;
      } catch (e) { dorar = `تعذّر (${e.message.slice(0, 30)})`; }
    }
    const kindLabel = c.kind === 'refer' ? 'سؤال' : c.athar ? 'قول صحابي' : `${c.kind === 'quran' ? 'آية' : 'حديث'}${c.unmarked ? ' دون علامة' : ''}`;
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
md += `| منها لم تكن أول نتيجة في البحث المباشر في الدرر هي النص المقتبس | ${total.issuesDorarNone} |\n| كل الادعاءات التي لم تكن أول نتيجة لها في الدرر هي النص المقتبس | ${total.dorarNone} |\n\n`;
md += `## حدود دلالة هذه النتائج\n\n- عدد النصوص صغير (${total.texts})، واختيرت يدويًا، فلا تُعمَّم نسبها على كل المحتوى الدعوي.\n- «البحث المباشر في الدرر» يمثل خطوة واحدة من التحقق اليدوي؛ المحقق الخبير يعيد صياغة البحث ويراجع المصحف وكتب التخريج، فيصل إلى أكثر مما تُظهره هذه المقارنة.\n- أحكام جِهْبَاذ منقولة من المصادر، ولم تُراجع نتائج هذه النصوص من مختص في علوم الحديث.\n`;
fs.writeFileSync('doc/real-texts-results.md', md);
console.log(`\n📄 doc/real-texts-results.md`);
console.log(total);
