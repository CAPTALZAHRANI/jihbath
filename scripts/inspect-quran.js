// Prints the shape of the downloaded Hafs mushaf so the index can be built on real fields.
import fs from 'node:fs';

const file = 'data/raw/quranpedia/mushafs-1.json';
const { license, data } = JSON.parse(fs.readFileSync(file, 'utf8'));
const cut = (v, n = 700) => JSON.stringify(v, null, 1).slice(0, n);

console.log('license.version:', license?.version);
console.log('rawi:', cut(data.rawi, 200));
console.log('surahs:', Array.isArray(data.surahs) ? data.surahs.length : typeof data.surahs);

const first = Array.isArray(data.surahs) ? data.surahs[0] : Object.values(data.surahs)[0];
console.log('\nfirst surah keys:', Object.keys(first).join(', '));
for (const [k, v] of Object.entries(first)) {
  if (Array.isArray(v)) {
    console.log(`\n[${k}] array(${v.length}) — first two items:`);
    console.log(cut(v.slice(0, 2), 1500));
  }
}
