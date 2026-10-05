// Builds data/index/quranenc.json from the downloaded QuranEnc translations.
import fs from 'node:fs';
import path from 'node:path';

const BASE = path.resolve(process.env.QURANENC_DIR || 'data');
const RAW = path.join(BASE, 'raw/quranenc');
const OUT = path.join(BASE, 'index/quranenc.json');
const files = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter((f) => f.endsWith('.json')) : [];
if (!files.length) { console.error(`no translations in ${RAW}`); process.exit(1); }

const translations = [];
const ayahs = [];
for (const f of files) {
  const t = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
  const k = translations.push({ key: t.key, title: t.title, version: t.version }) - 1;
  for (const a of t.ayahs) ayahs.push({ s: a.s, a: a.a, k, t: a.t });
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: 'QuranEnc.com', built_at: new Date().toISOString(), translations, ayahs }));
console.log(`✅ ${translations.length} translations, ${ayahs.length} ayah translations → ${OUT}`);
for (const t of translations) console.log(`   ${t.key} v${t.version} — ${t.title}`);
