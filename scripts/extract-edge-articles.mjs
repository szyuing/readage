/**
 * Extract english-ai:v2:articles from a copied Chromium Local Storage leveldb dir.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const out =
  process.argv[3] ||
  path.join(process.env.TEMP || '/tmp', 'english-ai-articles-dump.json');

if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: node extract-edge-articles.mjs <leveldb-copy-dir> [out.json]');
  process.exit(1);
}

const keyAscii = Buffer.from('english-ai:v2:articles');

function parseJsonArrayFromString(s) {
  if (!s.startsWith('[')) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
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
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(s.slice(0, k + 1));
          if (Array.isArray(parsed) && parsed[0]?.id && Array.isArray(parsed[0]?.content)) {
            return parsed;
          }
        } catch {
          return null;
        }
        return null;
      }
    }
  }
  return null;
}

function tryUtf16Array(buf, keyIdx) {
  for (let i = keyIdx; i < Math.min(buf.length, keyIdx + 500); i++) {
    if (buf[i] === 0x5b && buf[i + 1] === 0x00) {
      const chars = [];
      for (let j = i; j + 1 < buf.length && chars.length < 8_000_000; j += 2) {
        const code = buf[j] | (buf[j + 1] << 8);
        chars.push(String.fromCharCode(code));
      }
      const parsed = parseJsonArrayFromString(chars.join(''));
      if (parsed) return parsed;
    }
  }
  return null;
}

function tryAsciiArray(buf, keyIdx) {
  for (let i = keyIdx; i < Math.min(buf.length, keyIdx + 200); i++) {
    if (buf[i] === 0x5b && (i + 1 >= buf.length || buf[i + 1] !== 0x00)) {
      const s = buf.slice(i, Math.min(buf.length, i + 5_000_000)).toString('utf8');
      const parsed = parseJsonArrayFromString(s);
      if (parsed) return parsed;
    }
  }
  return null;
}

let articles = null;
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.ldb') && !f.endsWith('.log')) continue;
  const p = path.join(dir, f);
  let buf;
  try {
    buf = fs.readFileSync(p);
  } catch {
    continue;
  }
  let idx = 0;
  while ((idx = buf.indexOf(keyAscii, idx)) >= 0) {
    console.log('key in', f, 'at', idx);
    const utf16 = tryUtf16Array(buf, idx);
    const ascii = tryAsciiArray(buf, idx);
    for (const parsed of [utf16, ascii]) {
      if (parsed && (!articles || parsed.length > articles.length)) {
        articles = parsed;
        console.log('  captured', parsed.length, 'articles');
      }
    }
    idx += keyAscii.length;
  }
}

if (!articles) {
  console.error('FAILED to extract articles array');
  process.exit(2);
}

fs.writeFileSync(out, JSON.stringify(articles));
console.log('wrote', out, 'count', articles.length);

function needs(a) {
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

const incomplete = articles.filter(needs);
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
    Array.isArray(a.paragraphTranslations),
    '| R',
    Boolean(a.levelRating?.summary),
    '|',
    a.importEnrichmentStatus || '-'
  );
}
