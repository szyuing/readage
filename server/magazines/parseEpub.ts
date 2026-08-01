import JSZip from 'jszip';
import { convert as htmlToText } from 'html-to-text';
import { classifyArticleParagraph } from '../../src/lib/articlePresentation';

export interface ParsedChapter {
  title: string;
  paragraphs: string[];
  wordCount: number;
}

const MIN_WORDS = 80;
const SKIP_TITLE_RE =
  /^(cover|contents|table of contents|copyright|title page|masthead|colophon|advertisement|subscribe|credits|index)$/i;
const CALIBRE_ARTICLE_MARKER_RE =
  /This article was downloaded by calibre from[\s\S]*?(?:<\/(?:p|div|section|footer)>|\n)/gi;

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
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);
}

function cleanArticleParagraphs(paragraphs: string[]): string[] {
  return paragraphs.filter((paragraph) => classifyArticleParagraph(paragraph, '') !== 'furniture');
}

function splitHtmlDocuments(html: string): string[] {
  const semanticArticles = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)].map(
    (match) => match[0]
  );
  if (semanticArticles.length > 0) return semanticArticles;

  // Calibre sometimes concatenates article pages without semantic article tags.
  // Its download attribution is a stable end marker for each article in that form.
  const markers = [...html.matchAll(CALIBRE_ARTICLE_MARKER_RE)];
  if (markers.length > 1) {
    const documents: string[] = [];
    let start = 0;
    for (const marker of markers) {
      const end = (marker.index ?? 0) + marker[0].length;
      documents.push(html.slice(start, end));
      start = end;
    }
    if (start < html.length) documents.push(html.slice(start));
    return documents.filter((document) => /[A-Za-z]/.test(document));
  }

  return [html];
}

function textFromHtmlFragment(fragment: string): string {
  return htmlToText(fragment, { wordwrap: false })
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html: string, fallback: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const title = textFromHtmlFragment(h1[1]);
    if (title) return title.slice(0, 200);
  }
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag) {
    const title = textFromHtmlFragment(titleTag[1]);
    if (title && !/\.x?html?$/i.test(title)) return title.slice(0, 200);
  }
  const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (h2) {
    const title = textFromHtmlFragment(h2[1]);
    if (title) return title.slice(0, 200);
  }
  return fallback;
}

function parseHtmlDocument(html: string, fallbackTitle: string): ParsedChapter | null {
  const title = extractTitle(html, fallbackTitle);
  if (SKIP_TITLE_RE.test(title.trim())) return null;

  const rawParagraphs = paragraphsFromText(stripHtml(html));
  const paragraphs = cleanArticleParagraphs(rawParagraphs);
  const sourceWordCount = textWordCount(rawParagraphs.join(' '));
  const wordCount = textWordCount(paragraphs.join(' '));
  if (sourceWordCount < MIN_WORDS || wordCount === 0) return null;

  let chapterTitle = title;
  if (paragraphs[0] && chapterTitle.length > 120) {
    chapterTitle = paragraphs[0].slice(0, 80) + (paragraphs[0].length > 80 ? '...' : '');
  }

  return { title: chapterTitle, paragraphs, wordCount };
}

function resolvePath(baseDir: string, relative: string): string {
  const clean = relative.split('#')[0].replace(/\\/g, '/');
  if (!baseDir) return clean;
  const parts = [...baseDir.split('/').filter(Boolean), ...clean.split('/')];
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '..') stack.pop();
    else if (part !== '.') stack.push(part);
  }
  return stack.join('/');
}

function parseXmlAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
  const match = tag.match(re);
  return match ? match[1] : null;
}

async function readZipText(zip: JSZip, filePath: string): Promise<string | null> {
  const lower = filePath.toLowerCase();
  const key = Object.keys(zip.files).find((candidate) =>
    candidate.replace(/\\/g, '/').toLowerCase() === lower
  );
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

  const idToHref = new Map<string, string>();
  for (const itemMatch of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = parseXmlAttr(itemMatch[0], 'id');
    const href = parseXmlAttr(itemMatch[0], 'href');
    if (id && href) idToHref.set(id, href);
  }

  const spineIds: string[] = [];
  for (const refMatch of opf.matchAll(/<itemref\b[^>]*>/gi)) {
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

    for (const document of splitHtmlDocuments(html)) {
      const chapter = parseHtmlDocument(document, `Section ${index + 1}`);
      if (chapter) chapters.push(chapter);
      index += 1;
    }
  }

  // Fallback: if the spine produced nothing useful, inspect all HTML files.
  if (chapters.length === 0) {
    const htmlFiles = Object.keys(zip.files).filter(
      (filePath) => /\.(x?html?)$/i.test(filePath) && !zip.files[filePath].dir
    );
    for (let i = 0; i < htmlFiles.length; i += 1) {
      const html = await zip.files[htmlFiles[i]].async('text');
      for (const document of splitHtmlDocuments(html)) {
        const chapter = parseHtmlDocument(document, `Part ${i + 1}`);
        if (chapter) chapters.push(chapter);
      }
    }
  }

  return chapters;
}
