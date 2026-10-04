// Live check of the Dorar connector: raw response shape, parsed fields, and verdicts.
import { parseDorarHtml } from '../server/lib/dorar.js';
import { verifyHadith } from '../server/lib/hadith.js';

const UA = process.env.DORAR_UA || 'Mozilla/5.0 (compatible; JIHBATH/0.1; +https://github.com/CAPTALZAHRANI/jihbath)';

// 1) raw response — confirms the API shape before we trust the parser
const r = await fetch(`https://dorar.net/dorar_api.json?skey=${encodeURIComponent('إنما الأعمال بالنيات')}`, { headers: { 'User-Agent': UA } });
const body = await r.text();
console.log(`HTTP ${r.status} · ${body.length} chars`);
console.log('raw start:', body.slice(0, 400).replace(/\s+/g, ' '));
let parsed = [];
try { const j = JSON.parse(body); parsed = parseDorarHtml(j?.ahadith?.result ?? j?.result ?? ''); } catch (e) { console.log('not JSON:', e.message); }
console.log(`parsed ${parsed.length} items; first:`, parsed[0]);

// 2) verdicts on the prep-pack cases
const cases = [
  ['1 — صحيح مشهور', 'إنما الأعمال بالنيات'],
  ['2 — مشتهر على الألسنة', 'اطلبوا العلم ولو بالصين'],
  ['3 — قول منسوب', 'حب الوطن من الإيمان'],
  ['4 — قول منسوب', 'اختلاف أمتي رحمة'],
];
for (const [label, text] of cases) {
  try {
    const v = await verifyHadith(text);
    console.log(`\n[${label}] ${text}\n  → ${v.status} · checked ${v.checked}`);
    if (v.lead) console.log(`  ${v.lead.source} · ${v.lead.muhaddith} · «${v.lead.grade}» · ${v.lead.rawi} · coverage ${v.lead.coverage}`);
    if (v.groups?.length > 1) console.log(`  ${v.groups.length} narrators:`, v.groups.map((g) => `${g.rawi} («${g.grade}»)`).join(' | '));
  } catch (e) {
    console.log(`\n[${label}] ❌ ${e.message}`);
  }
}
