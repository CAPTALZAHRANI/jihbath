// Dorar.net hadith encyclopedia — official public JSON API.
// The API returns at most ~15 results as an HTML fragment; we parse it and cache by query.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API = 'https://dorar.net/dorar_api.json';
const UA = process.env.DORAR_UA || 'Mozilla/5.0 (compatible; JIHBATH/0.1; +https://github.com/CAPTALZAHRANI/jihbath)';
const CACHE_DIR = path.resolve('cache/dorar');
const memo = new Map();

const decode = (s) => String(s)
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

const FIELD = {
  'الراوي': 'rawi',
  'المحدث': 'muhaddith',
  'المصدر': 'source',
  'الصفحة أو الرقم': 'number',
  'خلاصة حكم المحدث': 'grade',
};

// Splits the HTML fragment into hadith blocks: a text div followed by an info div.
export function parseDorarHtml(html) {
  const out = [];
  const blocks = String(html).split(/<div[^>]*class=["']?hadith(?![-\w])["']?[^>]*>/i).slice(1);
  for (const block of blocks) {
    const [textPart, ...rest] = block.split(/<div[^>]*class=["']?hadith-info["']?[^>]*>/i);
    const info = rest.join(' ');
    const item = { text: decode(textPart.replace(/^\s*\d+\s*-\s*/, '')) };
    const parts = info.split(/<span[^>]*class=["']?info-subtitle["']?[^>]*>/i).slice(1);
    for (const p of parts) {
      const m = p.match(/^([^<]*?)\s*:?\s*<\/span>([\s\S]*)$/);
      if (!m) continue;
      const label = decode(m[1]).replace(/[:：]\s*$/, '').trim();
      const key = FIELD[label];
      if (key) item[key] = decode(m[2]);
    }
    if (item.text) out.push(item);
  }
  return out;
}

export async function searchDorar(query, { timeoutMs = 12000 } = {}) {
  const q = String(query).trim().split(/\s+/).slice(0, 14).join(' ');
  const key = crypto.createHash('sha1').update(q).digest('hex');
  if (memo.has(key)) return memo.get(key);
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    memo.set(key, cached);
    return cached;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(`${API}?skey=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json, text/javascript, */*' },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw new Error(`dorar HTTP ${r.status}`);
  const body = await r.text();
  let json;
  try { json = JSON.parse(body); } catch { throw new Error(`dorar returned non-JSON (${body.slice(0, 80)}…)`); }
  const html = json?.ahadith?.result ?? json?.result ?? '';
  const result = { query: q, items: parseDorarHtml(html), fetched_at: new Date().toISOString() };

  memo.set(key, result);
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(result)); } catch { /* cache is optional */ }
  return result;
}
