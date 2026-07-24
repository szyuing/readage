import JSZip from 'jszip';
import { convert as htmlToText } from 'html-to-text';

export interface ParsedChapter {
  title: string;
  paragraphs: string[];
  wordCount: number;
}

const MIN_WORDS = 80;
const SKIP_TITLE_RE =
  /^(cover|contents|table of contents|copyright|title page|masthead|colophon|advertisement|subscribe|credits|index)$/i;

function textWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function stripHtml(html: string): string {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'nav', format: 'skip' },
    ],
  });
}

function paragraphsFromText(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

function extractTitle(html: string, fallback: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const t = stripHtml(h1[1]).trim();
    if (t) return t.slice(0, 200);
  }
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag) {
    const t = stripHtml(titleTag[1]).trim();
    if (t && !/\.x?html?$/i.test(t)) return t.slice(0, 200);
  }
  const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (h2) {
    const t = stripHtml(h2[1]).trim();
    if (t) return t.slice(0, 200);
  }
  return fallback;
}

function resolvePath(baseDir: string, relative: string): string {
  const clean = relative.split('#')[0].replace(/\\/g, '/');
  if (!baseDir) return clean;
  const parts = [...baseDir.split('/').filter(Boolean), ...clean.split('/')];
  const stack: string[] = [];
  for (const p of parts) {
    if (p === '..') stack.pop();
    else if (p !== '.') stack.push(p);
  }
  return stack.join('/');
}

function parseXmlAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
}

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  // case-insensitive path match
  const lower = path.toLowerCase();
  const key = Object.keys(zip.files).find((k) => k.replace(/\\/g, '/').toLowerCase() === lower);
  if (!key) return null;
  return zip.files[key].async('text');
}

export async function parseEpubBuffer(buffer: Buffer): Promise<ParsedChapter[]> {
  const zip = await JSZip.loadAsync(buffer);
  const container = await readZipText(zip, 'META-INF/container.xml');
  if (!container) throw new Error('Invalid EPUB: missing META-INF/container.xml');

  const rootfileMatch = container.match(/full-path\s*=\s*["']([^"']+)["']/i);
  if (!rootfileMatch) throw new Error('Invalid EPUB: no rootfile in container.xml');
  const opfPath = rootfileMatch[1].replace(/\\/g, '/');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const opf = await readZipText(zip, opfPath);
  if (!opf) throw new Error(`Invalid EPUB: missing OPF ${opfPath}`);

  // id -> href map from manifest
  const idToHref = new Map<string, string>();
  const itemRe = /<item\b[^>]*>/gi;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemRe.exec(opf))) {
    const tag = itemMatch[0];
    const id = parseXmlAttr(tag, 'id');
    const href = parseXmlAttr(tag, 'href');
    if (id && href) idToHref.set(id, href);
  }

  const spineIds: string[] = [];
  const itemrefRe = /<itemref\b[^>]*>/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = itemrefRe.exec(opf))) {
    const idref = parseXmlAttr(refMatch[0], 'idref');
    if (idref) spineIds.push(idref);
  }

  const chapters: ParsedChapter[] = [];
  let index = 0;
  for (const id of spineIds) {
    const href = idToHref.get(id);
    if (!href) continue;
    const fullPath = resolvePath(opfDir, href);
    if (!/\.(x?html?|xml)$/i.test(fullPath)) continue;
    const html = await readZipText(zip, fullPath);
    if (!html) continue;

    const title = extractTitle(html, `Section ${index + 1}`);
    if (SKIP_TITLE_RE.test(title.trim())) {
      index += 1;
      continue;
    }

    const text = stripHtml(html);
    const paragraphs = paragraphsFromText(text);
    const body = paragraphs.join(' ');
    const wordCount = textWordCount(body);
    if (wordCount < MIN_WORDS) {
      index += 1;
      continue;
    }

    // Prefer title not equal to entire first paragraph when first para is long
    let chapterTitle = title;
    if (paragraphs[0] && chapterTitle.length > 120) {
      chapterTitle = paragraphs[0].slice(0, 80) + (paragraphs[0].length > 80 ? '…' : '');
    }

    chapters.push({
      title: chapterTitle,
      paragraphs,
      wordCount,
    });
    index += 1;
  }

  // Fallback: if spine produced nothing useful, dump all html files
  if (chapters.length === 0) {
    const htmlFiles = Object.keys(zip.files).filter((k) => /\.(x?html?)$/i.test(k) && !zip.files[k].dir);
    for (let i = 0; i < htmlFiles.length; i++) {
      const html = await zip.files[htmlFiles[i]].async('text');
      const paragraphs = paragraphsFromText(stripHtml(html));
      const wordCount = textWordCount(paragraphs.join(' '));
      if (wordCount < MIN_WORDS) continue;
      chapters.push({
        title: extractTitle(html, `Part ${i + 1}`),
        paragraphs,
        wordCount,
      });
    }
  }

  return chapters;
}
