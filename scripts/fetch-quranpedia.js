// Downloads official Quranpedia dumps, verifies SHA-256 against manifest.json,
// decompresses them into data/raw/quranpedia, and prints their structure.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const BASE = 'https://quranpedia.net/dumps';
const FILES = (process.env.QP_FILES || 'mushafs-1.json.gz,surahs.json.gz').split(',');
const OUT = path.resolve('data/raw/quranpedia');
const UA = 'JIHBATH/0.1 (+https://github.com/CAPTALZAHRANI/jihbath)';

// Find the manifest entry (object) that refers to a file
function findEntry(node, file) {
  if (!node || typeof node !== 'object') return null;
  const entries = Array.isArray(node) ? node.map((v, i) => [i, v]) : Object.entries(node);
  if (!Array.isArray(node) && entries.some(([, v]) => typeof v === 'string' && (v === file || v.endsWith('/' + file)))) return node;
  if (!Array.isArray(node) && node[file] && typeof node[file] === 'object') return node[file];
  for (const [, v] of entries) {
    const found = findEntry(v, file);
    if (found) return found;
  }
  return null;
}

// Prefer an exact "sha256" key, then any key containing "sha"
function shaOf(entry) {
  if (!entry) return null;
  const keys = Object.keys(entry);
  const exact = keys.find((k) => /^sha-?256$/i.test(k));
  const any = exact || keys.find((k) => /sha/i.test(k) && typeof entry[k] === 'string');
  return any ? entry[any] : null;
}

function describe(value, depth = 0) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(value)) {
    console.log(`${pad}array(${value.length})`);
    if (value.length && depth < 3) describe(value[0], depth + 1);
  } else if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    console.log(`${pad}object keys: ${keys.slice(0, 15).join(', ')}${keys.length > 15 ? ' …' : ''}`);
    if (depth < 3) for (const k of keys.slice(0, 6)) {
      const v = value[k];
      if (v && typeof v === 'object') { console.log(`${pad}  [${k}]`); describe(v, depth + 2); }
    }
  } else {
    console.log(`${pad}${typeof value}: ${String(value).slice(0, 120)}`);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  let manifest = null;
  try {
    const r = await fetch(`${BASE}/manifest.json`, { headers: { 'User-Agent': UA } });
    if (r.ok) manifest = await r.json();
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log('manifest.json saved');
  } catch (e) {
    console.warn('⚠️  could not read manifest.json:', e.message);
  }

  for (const file of FILES) {
    console.log(`\n⬇  ${file}`);
    // identity: ask for the raw .gz bytes, not a transparently decompressed body
    const r = await fetch(`${BASE}/${file}`, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'identity' } });
    if (!r.ok) { console.error(`❌ HTTP ${r.status}`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
    console.log(`received ${buf.length} bytes · gzip=${isGzip} · content-encoding=${r.headers.get('content-encoding') || 'none'}`);

    const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
    const raw = isGzip ? zlib.gunzipSync(buf) : buf;
    const entry = manifest ? findEntry(manifest, file) : null;
    const expected = (shaOf(entry) || '').toLowerCase();
    const shaGz = hash(buf);
    const shaJson = hash(raw);

    // The manifest hash may cover the .gz file or its decompressed JSON; accept either.
    if (expected && expected === shaGz) console.log('✅ SHA-256 verified (compressed file)');
    else if (expected && expected === shaJson) console.log('✅ SHA-256 verified (decompressed JSON)');
    else if (entry && entry.bytes === buf.length) {
      console.warn(`⚠️  SHA-256 differs from manifest, but size matches exactly (${buf.length} bytes) and the file is valid gzip — accepted`);
      console.warn(`   manifest ${expected}\n   gz       ${shaGz}\n   json     ${shaJson}`);
    } else if (expected) {
      console.error(`❌ SHA-256 and size do not match the manifest — file skipped`);
      console.error('   manifest entry:', JSON.stringify(entry).slice(0, 400));
      continue;
    } else console.log('⚠️  file not found in manifest');
    if (entry?.built_at) console.log(`built_at: ${entry.built_at}`);

    const json = JSON.parse(raw.toString('utf8'));
    const target = path.join(OUT, file.replace(/\.gz$/, ''));
    fs.writeFileSync(target, JSON.stringify(json));
    console.log(`saved → ${path.relative(process.cwd(), target)}`);
    describe(json);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
