// Builds data/index/quran.json from the Quranpedia Hafs dump (data/raw/quranpedia/mushafs-1.json).
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('data/raw/quranpedia/mushafs-1.json');
const OUT = path.resolve('data/index/quran.json');
const strip = (s) => String(s).replace(/[\uFEFF\u200B-\u200F]/g, '').trim();

const { license, data } = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const surahs = [];
const ayahs = [];
for (const s of data.surahs) {
  const id = Number(s.id);
  surahs.push({ id, name: s.name });
  for (const a of s.ayahs) ayahs.push({ s: id, a: Number(a.number), text: strip(a.text) });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  source: 'quranpedia.net — mushaf 1 (حفص)',
  version: license?.version || null,
  built_at: new Date().toISOString(),
  surahs,
  ayahs,
}));
console.log(`✅ ${surahs.length} surahs, ${ayahs.length} ayahs → ${path.relative(process.cwd(), OUT)} (version ${license?.version})`);
if (ayahs.length !== 6236) console.warn(`⚠️  expected 6236 ayahs, got ${ayahs.length}`);
