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
  // Observed corruption between string array items
  s = s.replace(/\u001d•,"/g, '","');
  s = s.replace(/\u001d•/g, '');
  s = s.replace(/•,"/g, '","');
  // Illegal control chars
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
  return s;
}

/**
 * Walk the string and try to JSON.parse every top-level {...} blob.
 * On failure, continue from next '{' after start+1 (does not require balanced close).
 */
function salvageObjects(s) {
  const objects = [];
  const seen = new Set();
  for (let start = 0; start < s.length; start++) {
    if (s[start] !== '{') continue;
    // Quick filter: only try objects that look like articles
    const window = s.slice(start, start + 80);
    if (!window.includes('"id"') && !window.includes('"content"')) continue;

    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let i = start; i < s.length; i++) {
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
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    const chunk = s.slice(start, end + 1);
    try {
      const obj = JSON.parse(chunk);
      if (obj && typeof obj.id === 'string' && Array.isArray(obj.content) && obj.content.length > 0) {
        if (!seen.has(obj.id)) {
          seen.add(obj.id);
          objects.push(obj);
        }
      }
    } catch {
      // try light repair inside chunk
      try {
        const repaired = chunk
          .replace(/\u001d•,"/g, '","')
          .replace(/•,"/g, '","')
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
        const obj = JSON.parse(repaired);
        if (obj && typeof obj.id === 'string' && Array.isArray(obj.content) && obj.content.length > 0) {
          if (!seen.has(obj.id)) {
            seen.add(obj.id);
            objects.push(obj);
          }
        }
      } catch {
        // skip
      }
    }
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

const byId = new Map();
for await (const [k, v] of db.iterator()) {
  const key = k.toString('utf8').replace(/[^\x20-\x7E]/g, '.');
  if (!key.endsWith('english-ai:v2:articles')) continue;

  const candidates = [
    repairLocalStorageJson(utf16be(v)),
    repairLocalStorageJson(v.toString('utf16le')),
  ];

  for (const s of candidates) {
    let list = [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = salvageObjects(s);
    }
    // Always also salvage to recover extra objects from partially-valid dumps
    const salvaged = salvageObjects(s);
    list = [...list, ...salvaged];

    let added = 0;
    for (const a of list) {
      if (!a?.id || !Array.isArray(a.content) || a.content.length === 0) continue;
      const prev = byId.get(a.id);
      // Prefer the version with more enrichment / more content
      if (!prev) {
        byId.set(a.id, a);
        added += 1;
      } else {
        const prevScore =
          (Array.isArray(prev.paragraphTranslations) ? prev.paragraphTranslations.length : 0) +
          (prev.levelRating?.summary ? 10 : 0) +
          (prev.content?.length || 0);
        const score =
          (Array.isArray(a.paragraphTranslations) ? a.paragraphTranslations.length : 0) +
          (a.levelRating?.summary ? 10 : 0) +
          (a.content?.length || 0);
        if (score > prevScore) byId.set(a.id, a);
      }
    }
    console.log(key.slice(0, 70), 'parsed/salvaged batch', list.length, 'new', added, 'map', byId.size);
  }
}

await db.close();

const best = [...byId.values()];
fs.mkdirSync('local-data', { recursive: true });
fs.writeFileSync('local-data/articles-from-edge.json', JSON.stringify(best));
console.log('TOTAL unique articles', best.length);
const incomplete = best.filter(needsEnrichment);
console.log('incomplete', incomplete.length);
for (const a of incomplete) {
  const n = (a.content || []).length;
  const t = a.paragraphTranslations;
  const tc =
    Array.isArray(t) && t.length === n && t.every((x) => typeof x === 'string' && x.trim());
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
