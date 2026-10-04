// Calibrates the meaning-level layer: prints the top matches and similarity for
// paraphrases (should match) and fabricated/unrelated sayings (should NOT match).
import { loadHadeethEnc, verifyByMeaning } from '../server/lib/hadeethenc.js';
import { searchByMeaning, MODEL } from '../server/lib/semantic.js';
import fs from 'node:fs';
import path from 'node:path';

const { items } = JSON.parse(fs.readFileSync(path.resolve(process.env.HADEETHENC_DIR || 'data', 'index/hadeethenc.json'), 'utf8'));
const byId = new Map(items.map((h) => [h.id, h]));
console.log('model:', MODEL);

loadHadeethEnc();
const cases = [
  ['paraphrase', 'Actions are only by intentions'],
  ['paraphrase', 'Deeds are judged by their intentions'],
  ['paraphrase', 'The one who sponsors an orphan and I will be like these two in Paradise'],
  ['fabricated', 'Seek knowledge even if you have to go as far as China'],
  ['fabricated', 'Love of one\u2019s homeland is part of faith'],
  ['unrelated', 'Drink plenty of water every morning for good health'],
];
for (const [kind, q] of cases) {
  const top = await searchByMeaning(q, 3);
  const v = await verifyByMeaning(q);
  console.log(`\n[${kind}] ${q}\n  → ${v.status}${v.similarity ? ' · ' + v.similarity : ''}${v.shared ? ' · shared: ' + (v.shared.join(', ') || '—') : ''}`);
  for (const t of top || []) console.log(`    ${t.similarity}  #${t.id}  ${byId.get(t.id)?.title?.slice(0, 60) || ''}\n           ↳ ${String(t.chunk || '').slice(0, 110)}`);
  if (v.en?.text) console.log(`  official: ${v.en.text.slice(0, 160)}`);
}
