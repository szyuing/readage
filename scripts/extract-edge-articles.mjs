/**
 * Extract english-ai:v2:articles from a Chromium Local Storage leveldb copy.
 *
 * Chromium stores localStorage values as UTF-16LE strings.
 * Keys look like: _http://127.0.0.1:3000\x00\x01english-ai:v2:articles
 */
import fs from 'node:fs';
import path from 'node:path';
import { ClassicLevel } from 'classic-level';

const dir = process.argv[2];
const out =
  process.argv[3] ||
  path.join(process.env.TEMP || '/tmp', 'english-ai-articles-dump.json');

if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: node extract-edge-articles.mjs <leveldb-copy-dir> [out.json]');
  process.exit(1);
}

function utf16beToString(buf) {
  // Node has no utf16be; swap to LE then decode.
  const evenLen = buf.length - (buf.length % 2);
  const swapped = Buffer.allocUnsafe(evenLen);
  for (let i = 0; i < evenLen; i += 2) {
    swapped[i] = buf[i + 1];
    swapped[i + 1] = buf[i];
  }
  return swapped.toString('utf16le');
}

function decodeMaybeUtf16(buf) {
  if (!Buffer.isBuffer(buf)) {
    if (typeof buf === 'string') return buf;
    return String(buf);
  }
  // Chromium localStorage values are UTF-16. Some dumps start with a leading 0x00
  // so that the payload is effectively UTF-16BE (`00 5b 00 7b …` → `[{`).
  const candidates = [];
  if (buf.length >= 2) {
    candidates.push(buf.toString('utf16le'));
    candidates.push(utf16beToString(buf));
  }
  if (buf.length >= 3 && buf[0] === 0x00) {
    candidates.push(buf.subarray(1).toString('utf16le'));
  }
  if (buf.length >= 3 && buf[buf.length - 1] === 0x00 && buf.length % 2 === 1) {
    candidates.push(buf.subarray(0, buf.length - 1).toString('utf16le'));
  }
  candidates.push(buf.toString('utf8'));

  for (const s of candidates) {
    const trimmed = s.replace(/^\u0000+/, '').trimStart();
    if (trimmed.startsWith('[') || trimmed.startsWith('{') || trimmed.startsWith('"')) {
      return trimmed;
    }
  }
  // Prefer utf16le for non-JSON string values
  return (candidates[0] || buf.toString('utf8')).replace(/^\u0000+/, '');
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

const db = new ClassicLevel(dir, {
  keyEncoding: 'buffer',
  valueEncoding: 'buffer',
  createIfMissing: false,
  errorIfExists: false,
});

let articles = null;
let foundKeys = 0;

for await (const [keyBuf, valBuf] of db.iterator()) {
  const key = decodeMaybeUtf16(keyBuf);
  const keyUtf8 = Buffer.isBuffer(keyBuf) ? keyBuf.toString('utf8') : String(key);
  const keyStr = `${key}\n${keyUtf8}`;
  const preview = keyUtf8.replace(/[^\x20-\x7E]/g, '.');
  const isArticlesKey =
    preview.endsWith('english-ai:v2:articles')
    || keyUtf8.endsWith('english-ai:v2:articles')
    || key.endsWith('english-ai:v2:articles');
  if (!isArticlesKey) continue;

  foundKeys += 1;
  const value = decodeMaybeUtf16(valBuf);
  console.log(
    'HIT',
    preview.slice(0, 120),
    'val len',
    valBuf.length,
    'value starts',
    JSON.stringify(value.slice(0, 80))
  );
  try {
    // LevelDB copies can introduce raw control bytes; JSON only allows escaped ones.
    const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      // Prefer the larger dump (localhost vs 127.0.0.1 may both exist).
      if (!articles || parsed.length >= articles.length) {
        articles = parsed;
        console.log('parsed array length', parsed.length, 'from', preview.slice(0, 80));
      }
    }
  } catch (e) {
    console.log('JSON parse failed:', e.message);
    // Last resort: strip all ASCII control chars including CR/LF.
    try {
      const loose = value.replace(/[\u0000-\u001F]/g, ' ');
      const parsed = JSON.parse(loose);
      if (Array.isArray(parsed) && (!articles || parsed.length >= articles.length)) {
        articles = parsed;
        console.log('parsed (loose) array length', parsed.length);
      }
    } catch (e2) {
      console.log('loose parse failed:', e2.message);
    }
  }
}

await db.close();

if (!articles) {
  // Fallback: dump all keys containing 3000
  console.error('Primary extract failed; listing related keys…');
  const db2 = new ClassicLevel(dir, {
    keyEncoding: 'buffer',
    valueEncoding: 'buffer',
    createIfMissing: false,
  });
  let n = 0;
  for await (const [keyBuf, valBuf] of db2.iterator()) {
    const k = keyBuf.toString('utf8').replace(/[^\x20-\x7E]/g, '.');
    if (k.includes('3000') || k.includes('english-ai')) {
      n += 1;
      console.log('KEY', k.slice(0, 200), 'VAL', valBuf.length);
      if (k.includes('articles')) {
        const v16 = valBuf.toString('utf16le');
        const v8 = valBuf.toString('utf8');
        console.log('  utf16 head', JSON.stringify(v16.slice(0, 100)));
        console.log('  utf8 head', JSON.stringify(v8.slice(0, 100)));
      }
    }
  }
  await db2.close();
  console.error('found related keys', n, 'article-key hits', foundKeys);
  process.exit(2);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(articles));
console.log('wrote', out, 'count', articles.length);

const incomplete = articles.filter(needsEnrichment);
console.log('incomplete', incomplete.length);
for (const a of incomplete) {
  console.log(
    '-',
    a.id,
    '|',
    String(a.title || '').slice(0, 50),
    '| paras',
    (a.content || []).length,
    '| T',
    Array.isArray(a.paragraphTranslations) ? a.paragraphTranslations.length : 0,
    '| R',
    Boolean(a.levelRating?.summary),
    '|',
    a.importEnrichmentStatus || '-'
  );
}
