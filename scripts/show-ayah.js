// Prints the official translations of one ayah from the local QuranEnc index, and what the
// English matcher finds for a quote.   node scripts/show-ayah.js 2 153 "Indeed, Allah is with the patient"
import fs from 'node:fs';
import path from 'node:path';
import { loadQuranEnc, verifyQuranEnglish } from '../server/lib/quranenc.js';

const [s, a, quote] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const idx = JSON.parse(fs.readFileSync(path.resolve(process.env.QURANENC_DIR || 'data', 'index/quranenc.json'), 'utf8'));
for (const x of idx.ayahs.filter((x) => x.s === s && x.a === a)) console.log(`${idx.translations[x.k].key}: ${x.t}\n`);
if (quote) {
  loadQuranEnc();
  const r = verifyQuranEnglish(quote);
  console.log(`quote → ${r.status} · coverage ${r.coverage ?? '-'} · ${r.surah ?? ''}:${r.ayah ?? ''} · ${r.translation?.key ?? ''}`);
}
