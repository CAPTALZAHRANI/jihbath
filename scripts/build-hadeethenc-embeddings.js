// Embeds every HadeethEnc hadith (Arabic core text + official English translation)
// for meaning-level matching of translated quotes. Runs once; the model is cached.
import fs from 'node:fs';
import path from 'node:path';
import { embed, hadithCore, MODEL } from '../server/lib/semantic.js';

const BASE = path.resolve(process.env.HADEETHENC_DIR || 'data');
const SRC = path.join(BASE, 'index/hadeethenc.json');
const { items } = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// Quotes usually cite one sentence of a hadith, and averaging a whole long hadith into one
// vector dilutes that sentence. So each hadith is split into sentence-sized chunks
// (official English translation AND Arabic), and a hadith scores as its best chunk.
function splitChunks(text) {
  const parts = String(text || '').split(/(?<=[.;!?؛؟])\s+|،\s+|,\s+(?=and\s|so\s|but\s)/);
  const out = [];
  let cur = [];
  for (const p of parts) {
    cur.push(p);
    const words = cur.join(' ').split(/\s+/).filter(Boolean).length;
    if (words >= 6) { out.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) {
    if (out.length) out[out.length - 1] += ' ' + cur.join(' ');
    else out.push(cur.join(' '));
  }
  return out.map((c) => c.split(/\s+/).slice(0, 45).join(' ')).filter((c) => c.trim().length > 8);
}

const passages = [];
const owners = [];
for (const h of items) {
  const all = [...(h.en?.text ? splitChunks(hadithCore(h.en.text)) : []), ...splitChunks(hadithCore(h.text))];
  for (const c of all) { passages.push(c); owners.push(h.id); }
}
console.log(`${items.length} hadiths → ${passages.length} sentence chunks`);

const BATCH = 32;
let dim = 0;
const chunks = [];
const t0 = Date.now();
for (let i = 0; i < passages.length; i += BATCH) {
  const { data, dim: d } = await embed(passages.slice(i, i + BATCH), 'passage');
  dim = d;
  chunks.push(Float32Array.from(data));
  if ((i / BATCH) % 50 === 0) console.log(`${Math.min(i + BATCH, passages.length)}/${passages.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
let off = 0;
for (const c of chunks) { all.set(c, off); off += c.length; }

fs.writeFileSync(path.join(BASE, 'index/hadeethenc-emb.bin'), Buffer.from(all.buffer));
fs.writeFileSync(path.join(BASE, 'index/hadeethenc-emb.json'), JSON.stringify({ model: MODEL, dim, ids: owners, chunks: passages, built_at: new Date().toISOString() }));
console.log(`✅ ${items.length} hadiths · ${passages.length} chunks embedded (${dim} dims, ${MODEL}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
