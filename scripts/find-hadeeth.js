// Searches the local HadeethEnc index for hadiths containing all given words (normalized).
//   node scripts/find-hadeeth.js دل خير أجر
import fs from 'node:fs';
import path from 'node:path';
import { normalizeWord } from '../server/lib/arabic.js';

const words = process.argv.slice(2).map(normalizeWord).filter(Boolean);
const { items } = JSON.parse(fs.readFileSync(path.resolve(process.env.HADEETHENC_DIR || 'data', 'index/hadeethenc.json'), 'utf8'));
const hits = items.filter((h) => {
  const t = String(h.text).split(/\s+/).map(normalizeWord).join(' ');
  return words.every((w) => t.includes(w));
});
console.log(`${hits.length} hadith(s) contain: ${words.join(' + ')}`);
for (const h of hits.slice(0, 5)) console.log(`\n#${h.id} ${h.title}\n  ${String(h.text).slice(0, 160)}`);
