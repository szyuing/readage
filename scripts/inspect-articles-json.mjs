import fs from 'node:fs';
import { ClassicLevel } from 'classic-level';

const dir = process.argv[2] || `${process.env.TEMP}\\edge-ls-copy-fresh`;
const db = new ClassicLevel(dir, {
  keyEncoding: 'buffer',
  valueEncoding: 'buffer',
  createIfMissing: false,
});

function utf16be(buf) {
  const n = buf.length - (buf.length % 2);
  const s = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i += 2) {
    s[i] = buf[i + 1];
    s[i + 1] = buf[i];
  }
  return s.toString('utf16le');
}

function repairLocalStorageJson(raw) {
  let s = raw.replace(/^\u0000+/, '').trimStart();
  // Observed corruption: paragraph separators "," became \u001d•,"
  s = s.replace(/\u001d•,"/g, '","');
  s = s.replace(/\u001d•/g, '');
  // Strip remaining illegal control chars (keep tab/LF/CR as spaces)
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
  return s;
}

function salvageObjects(s) {
  const objects = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '{') {
      i += 1;
      continue;
    }
    let depth = 0;
    let inStr = false;
    let esc = false;
    const start = i;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === '\\') {
          esc = true;
          continue;
        }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const chunk = s.slice(start, i + 1);
          try {
            const obj = JSON.parse(chunk);
            if (obj && obj.id && Array.isArray(obj.content)) objects.push(obj);
          } catch {
            // skip
          }
          i += 1;
          break;
        }
      }
    }
    if (depth !== 0) break;
  }
  return objects;
}

function needsEnrichment(a) {
  const n = (a.content || []).length;
  if (!n) return false;
  const t = a.paragraphTranslations;
  const tc =
    Array.isArray(t) &&
    t.length === n &&
    t.every((x) => typeof x === 'string' && x.trim().length > 0);
  const r = Boolean(a.levelRating?.level && a.levelRating?.summary);
  return !tc || !r;
}

let best = [];
for await (const [k, v] of db.iterator()) {
  const key = k.toString('utf8').replace(/[^\x20-\x7E]/g, '.');
  if (!key.endsWith('english-ai:v2:articles')) continue;

  const candidates = [
    repairLocalStorageJson(utf16be(v)),
    repairLocalStorageJson(v.toString('utf16le')),
  ];

  for (const s of candidates) {
    let parsed = null;
    try {
      parsed = JSON.parse(s);
    } catch {
      parsed = salvageObjects(s);
    }
    if (!Array.isArray(parsed)) continue;
    const valid = parsed.filter((a) => a && a.id && Array.isArray(a.content));
    console.log(key.slice(0, 60), 'got', valid.length, 'objects, rawLen', s.length);
    if (valid.length > best.length) best = valid;
  }
}

await db.close();

fs.mkdirSync('local-data', { recursive: true });
fs.writeFileSync('local-data/articles-from-edge.json', JSON.stringify(best));
console.log('TOTAL articles', best.length);
const incomplete = best.filter(needsEnrichment);
console.log('incomplete', incomplete.length);
for (const a of incomplete) {
  const n = (a.content || []).length;
  const t = a.paragraphTranslations;
  const tc = Array.isArray(t) && t.length === n && t.every((x) => typeof x === 'string' && x.trim());
  console.log(
    '-',
    a.id,
    '|',
    String(a.title || '').slice(0, 45),
    '| n',
    n,
    '| needT',
    !tc,
    '| needR',
    !(a.levelRating?.level && a.levelRating?.summary),
    '| st',
    a.importEnrichmentStatus || '-'
  );
}
fs.writeFileSync('local-data/articles-incomplete.json', JSON.stringify(incomplete, null, 2));
console.log('wrote local-data/articles-incomplete.json');
