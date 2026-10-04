// Builds a local copy of HadeethEnc (hadeethenc.com) through its public API.
// The API has no text search, so: categories → hadith ids → each hadith by id.
// Resumable: re-running skips hadiths already saved. Content is stored unmodified.
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://hadeethenc.com/api/v1';
const LANGS = (process.env.HE_LANGS || 'ar,en').split(',');
const DELAY = Number(process.env.HE_DELAY_MS || 300);
const PER_PAGE = 100;
const OUT = path.resolve('data/raw/hadeethenc');
const UA = 'JIHBATH/0.1 (+https://github.com/CAPTALZAHRANI/jihbath)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.fatal = true; throw e; }
      return await r.json();
    } catch (e) {
      if (e.fatal || i === tries) throw e;
      await sleep(2000 * i);
    } finally {
      await sleep(DELAY);
    }
  }
}

async function collectIds(lang) {
  const cats = await get(`${API}/categories/list/?language=${lang}`);
  const list = Array.isArray(cats) ? cats : cats.data || [];
  console.log(`[${lang}] ${list.length} categories`);
  const ids = new Set();
  for (const cat of list) {
    for (let page = 1; ; page++) {
      const res = await get(`${API}/hadeeths/list/?language=${lang}&category_id=${cat.id}&page=${page}&per_page=${PER_PAGE}`);
      const items = Array.isArray(res) ? res : res.data || [];
      items.forEach((h) => ids.add(String(h.id)));
      const last = Number(res?.meta?.last_page);
      if (!items.length || (last ? page >= last : items.length < PER_PAGE)) break;
    }
  }
  return [...ids];
}

async function run(lang) {
  const idsFile = path.join(OUT, `${lang}-ids.json`);
  const dataFile = path.join(OUT, `${lang}.jsonl`);
  const failFile = path.join(OUT, `${lang}-failed.txt`);

  let ids;
  if (fs.existsSync(idsFile)) {
    ids = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
    console.log(`[${lang}] ${ids.length} ids (cached)`);
  } else {
    ids = await collectIds(lang);
    fs.writeFileSync(idsFile, JSON.stringify(ids));
    console.log(`[${lang}] ${ids.length} unique hadith ids`);
  }

  const done = new Set();
  if (fs.existsSync(dataFile)) {
    for (const line of fs.readFileSync(dataFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { done.add(String(JSON.parse(line).id)); } catch { /* partial line */ }
    }
  }
  const todo = ids.filter((id) => !done.has(id));
  console.log(`[${lang}] ${done.size} already saved, ${todo.length} to fetch`);

  let n = 0;
  for (const id of todo) {
    try {
      const h = await get(`${API}/hadeeths/one/?id=${id}&language=${lang}`);
      fs.appendFileSync(dataFile, JSON.stringify(h) + '\n');
      if (n === 0 && done.size === 0) console.log(`[${lang}] record keys: ${Object.keys(h).join(', ')}`);
    } catch (e) {
      fs.appendFileSync(failFile, `${id}\t${e.message}\n`);
    }
    if (++n % 100 === 0) console.log(`[${lang}] ${n}/${todo.length}`);
  }
  console.log(`[${lang}] ✅ done`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const lang of LANGS) await run(lang.trim());
}

main().catch((e) => { console.error(e); process.exit(1); });
