// Builds a compact HadeethEnc index (Arabic text + official English translation) from the
// raw API copy. Content is kept unmodified, as HadeethEnc's terms require.
import fs from 'node:fs';
import path from 'node:path';

const BASE = path.resolve(process.env.HADEETHENC_DIR || 'data');
const RAW = path.join(BASE, 'raw/hadeethenc');
const OUT = path.join(BASE, 'index/hadeethenc.json');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

const ar = readJsonl(path.join(RAW, 'ar.jsonl'));
const en = new Map(readJsonl(path.join(RAW, 'en.jsonl')).map((h) => [String(h.id), h]));
if (!ar.length) { console.error(`no Arabic records in ${RAW}`); process.exit(1); }

const items = ar.map((h) => {
  const e = en.get(String(h.id));
  return {
    id: String(h.id),
    title: h.title,
    text: h.hadeeth,
    attribution: h.attribution,
    grade: h.grade,
    en: e ? { text: e.hadeeth, grade: e.grade, attribution: e.attribution } : null,
  };
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  source: 'HadeethEnc.com — موسوعة الأحاديث النبوية',
  built_at: new Date().toISOString(),
  count: items.length,
  with_english: items.filter((i) => i.en).length,
  items,
}));
console.log(`✅ ${items.length} hadiths (${items.filter((i) => i.en).length} with English) → ${OUT}`);
