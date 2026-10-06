// Meaning-level matching for translated content (agreed design: translated text is matched
// by meaning, not wording). A multilingual embedding model runs inside the server
// (no external AI API, no generated text): it only RETRIEVES the closest hadith, whose
// official text, translation and grade are then shown exactly as published.
import fs from 'node:fs';
import path from 'node:path';

const BASE = path.resolve(process.env.HADEETHENC_DIR || 'data');
const EMB = path.join(BASE, 'index/hadeethenc-emb.bin');
const META = path.join(BASE, 'index/hadeethenc-emb.json');
// A paraphrase-trained multilingual model: unlike e5 (whose scores bunch up around 0.85
// for everything), it spreads unrelated vs. same-meaning sentences far apart.
export const MODEL = process.env.SEMANTIC_MODEL || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const PREFIXED = /e5/i.test(MODEL); // e5 models need "query:" / "passage:" prefixes

// Two thresholds: very close = same hadith in other words; close = needs a specialist,
// because a fabricated saying can resemble an authentic hadith in meaning.
const HIGH = Number(process.env.SEMANTIC_HIGH || 0.8);
const LOW = Number(process.env.SEMANTIC_LOW || 0.65);

let extractor = null;
let VEC = null; // { ids, dim, data: Float32Array }

export async function getEmbedder() {
  if (extractor) return extractor;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = path.join(BASE, 'models'); // on Railway: the persistent volume
  extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  return extractor;
}

export async function embed(texts, prefix) {
  const ex = await getEmbedder();
  const out = await ex(PREFIXED ? texts.map((t) => `${prefix}: ${t}`) : texts, { pooling: 'mean', normalize: true });
  return { data: out.data, dim: out.dims[out.dims.length - 1] };
}

// The words of the hadith itself, without the chain ("عن فلان قال: «...»")
export function hadithCore(text) {
  const m = String(text || '').match(/«([^»]{5,})»/) || String(text || '').match(/"([^"]{5,})"/) || String(text || '').match(/“([^”]{5,})”/);
  return (m ? m[1] : String(text || '')).slice(0, 600);
}

export function loadSemantic() {
  if (!fs.existsSync(EMB) || !fs.existsSync(META)) return false;
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  if (meta.model !== MODEL) { console.warn(`⚠️  meaning index was built with ${meta.model}; rebuild for ${MODEL}`); return false; }
  const buf = fs.readFileSync(EMB);
  VEC = { ids: meta.ids, chunks: meta.chunks || [], dim: meta.dim, data: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), model: meta.model };
  return true;
}

export const semanticReady = () => !!VEC;

export async function searchByMeaning(quote, k = 3) {
  if (!VEC) return null;
  const { data: q } = await embed([quote], 'query');
  const { ids, dim, data, chunks } = VEC;
  // best chunk per hadith
  const best = new Map();
  for (let i = 0; i < ids.length; i++) {
    let s = 0;
    const off = i * dim;
    for (let d = 0; d < dim; d++) s += q[d] * data[off + d];
    const prev = best.get(ids[i]);
    if (!prev || s > prev.s) best.set(ids[i], { s, chunk: chunks[i] });
  }
  return [...best.entries()]
    .sort((a, b) => b[1].s - a[1].s)
    .slice(0, k)
    .map(([id, v]) => ({ id, similarity: Number(v.s.toFixed(3)), chunk: v.chunk }));
}

// A meaning match must also share at least one content word with the matched sentence,
// otherwise a different saying that merely sounds alike (حب الوطن ↔ حب الأنصار) slips through.
const STOP = new Set('the and that this with from have will been were they them their there what when which while would could should shall upon unto said says your yours ours only even also into onto than then just like some such very more most much many each every other because about over under after before being does done doing make made allah prophet messenger peace blessings upon reported narrated'.split(' '));
const stem = (w) => w.replace(/(ings|ing|ed|es|s)$/, '');
const content = (t) => new Set(String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem));

export function sharedWords(quote, chunk) {
  const a = content(quote), b = content(chunk);
  return [...a].filter((w) => b.has(w));
}

export function meaningLevel(similarity, shared = []) {
  if (similarity >= HIGH) return 'strong';
  if (similarity >= LOW && shared.length >= 1) return 'possible';
  return 'none';
}
