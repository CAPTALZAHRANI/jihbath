// Diagnoses the local HadeethEnc index: load status, a sample English record, and two lookups.
import { loadHadeethEnc, hadeethEncStatus, verifyHadeethEnc } from '../server/lib/hadeethenc.js';
import fs from 'node:fs';
import path from 'node:path';

console.log('loaded:', loadHadeethEnc(), hadeethEncStatus());
const file = path.resolve(process.env.HADEETHENC_DIR || 'data', 'index/hadeethenc.json');
const { items } = JSON.parse(fs.readFileSync(file, 'utf8'));
const hit = items.filter((h) => h.en && /intention/i.test(h.en.text)).slice(0, 3);
for (const h of hit) console.log(`\n#${h.id} AR: ${h.text.slice(0, 90)}\n     EN: ${h.en.text.slice(0, 220)}`);

for (const q of ['إنما الأعمال بالنيات', 'Actions are only by intentions']) {
  const r = verifyHadeethEnc(q);
  console.log(`\n${q} → ${r.status} · coverage ${r.coverage ?? '-'} · #${r.id ?? '-'}`);
  if (r.ops) console.log('  diffs:', JSON.stringify(r.ops.filter((o) => o.type !== 'equal')));
  if (r.closest) console.log('  closest:', r.closest);
  if (r.id) {
    const h = items.find((x) => x.id === r.id);
    console.log(`  #${r.id} English: ${h.en ? h.en.text.slice(0, 300) : '(no English translation in the index)'}`);
  }
}
