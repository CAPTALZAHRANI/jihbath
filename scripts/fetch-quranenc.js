// Downloads official translations of the meanings of the Quran from QuranEnc.com (approved
// reference) for translated-content verification. Terms honoured: content unmodified,
// source and version shown with every result.
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://quranenc.com/api/v1';
const LANG = process.env.QE_LANG || 'en';
const ONLY = (process.env.QE_KEYS || '').split(',').filter(Boolean);
const OUT = path.resolve(process.env.QURANENC_DIR || 'data', 'raw/quranenc');
const UA = 'JIHBATH/0.1 (+https://github.com/CAPTALZAHRANI/jihbath)';
const DELAY = Number(process.env.QE_DELAY_MS || 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries) throw e;
      await sleep(1500 * i);
    } finally { await sleep(DELAY); }
  }
}

fs.mkdirSync(OUT, { recursive: true });
const list = await get(`${API}/translations/list/${LANG}`);
let translations = (list.translations || list).filter((t) => t.language_iso_code === LANG);
if (ONLY.length) translations = translations.filter((t) => ONLY.includes(t.key));
console.log(`${translations.length} ${LANG} translations: ${translations.map((t) => t.key).join(', ')}`);

for (const t of translations) {
  const file = path.join(OUT, `${t.key}.json`);
  if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).version === t.version) {
    console.log(`= ${t.key} v${t.version} (cached)`); continue;
  }
  const ayahs = [];
  for (let s = 1; s <= 114; s++) {
    const res = await get(`${API}/translation/sura/${t.key}/${s}`);
    for (const a of (res.result || res)) ayahs.push({ s: Number(a.sura), a: Number(a.aya), t: a.translation });
  }
  fs.writeFileSync(file, JSON.stringify({ key: t.key, title: t.title, version: t.version, last_update: t.last_update, ayahs }));
  console.log(`✅ ${t.key} v${t.version}: ${ayahs.length} ayahs`);
}
