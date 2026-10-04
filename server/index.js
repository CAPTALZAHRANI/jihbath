import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuran, quranReady, verifyQuran } from './lib/quran.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '1mb' }));

const quran = loadQuran();
console.log(quran ? `📖 Quran index loaded (${quran.ayahs.length} ayahs, version ${quran.meta.version})` : '⚠️  Quran index missing — run: npm run fetch:quran && npm run build:quran');

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    name: 'jihbath',
    time: new Date().toISOString(),
    sources: { quran: quranReady() ? quran.meta.version : null },
  });
});

app.post('/api/verify/quran', (req, res) => {
  const text = String(req.body?.text || '').slice(0, 2000);
  if (!text.trim()) return res.status(400).json({ error: 'text is required' });
  const result = verifyQuran(text);
  if (result.status === 'unavailable') return res.status(503).json(result);
  res.json(result);
});

// Serve the built React client (client/dist) when it exists
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ JIHBATH server running on port ${port}`);
});
