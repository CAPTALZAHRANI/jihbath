// Runs the Quran test cases from the prep pack against the real local index.
import { loadQuran, verifyQuran } from '../server/lib/quran.js';

const cases = [
  ['6 — آية بلفظ محرَّف', 'وما خلقت الجن والإنس إلا ليعبدوني'],
  ['7 — آية نُسبت حديثًا', 'إن الله مع الصابرين'],
  ['8 — اقتطاع آية', 'ولا تقربوا الصلاة'],
  ['آية كاملة', 'الحمد لله رب العالمين'],
  ['ليس قرآنًا', 'اطلبوا العلم ولو بالصين'],
];

if (!loadQuran()) { console.error('Quran index missing — run: npm run build:quran'); process.exit(1); }
for (const [label, text] of cases) {
  const r = verifyQuran(text);
  const ref = r.ref ? `${r.ref.surahName} ${r.ref.from}${r.ref.to !== r.ref.from ? '–' + r.ref.to : ''}` : '—';
  const diffs = (r.ops || []).filter((o) => o.type !== 'equal')
    .map((o) => `${o.type}: «${o.said.join(' ')}» ← «${o.source.join(' ')}»`).join(' · ');
  console.log(`\n[${label}] ${text}\n  → ${r.status} · ${ref} · coverage ${r.coverage ?? '-'}${diffs ? '\n  ' + diffs : ''}`);
  if (r.alternatives?.length) console.log('  also at:', r.alternatives.map((a) => `${a.surahName} ${a.from}`).join(', '));
}
