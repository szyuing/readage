import { PDFParse } from 'pdf-parse';

export interface ParsedChapter {
  title: string;
  paragraphs: string[];
  wordCount: number;
}

const MIN_WORDS = 80;
const CHUNK_WORDS = 900;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function paragraphsFromText(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 20);
}

/**
 * Weak PDF split: extract text and chunk into pseudo-articles.
 * Marked partial quality by caller.
 */
export async function parsePdfBuffer(buffer: Buffer): Promise<ParsedChapter[]> {
  const parser = new PDFParse({ data: buffer });
  let text = '';
  try {
    const data = await parser.getText();
    text = data.text || '';
  } finally {
    await parser.destroy();
  }
  const full = text.trim();
  if (!full) return [];

  // Try split on lines that look like titles (short, Title Case-ish)
  const lines = full.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const blocks: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const isHeading =
      line.length > 3 &&
      line.length < 90 &&
      !/[.!?]$/.test(line) &&
      wordCount(line) <= 12 &&
      /[A-Za-z]/.test(line);
    if (isHeading && (!current || current.lines.length > 3)) {
      if (current) blocks.push(current);
      current = { title: line, lines: [] };
    } else {
      if (!current) current = { title: 'Article', lines: [] };
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);

  let chapters: ParsedChapter[] = blocks
    .map((b) => {
      const paragraphs = paragraphsFromText(b.lines.join('\n\n'));
      return {
        title: b.title,
        paragraphs,
        wordCount: wordCount(paragraphs.join(' ')),
      };
    })
    .filter((c) => c.wordCount >= MIN_WORDS);

  // Fallback: fixed-size word windows
  if (chapters.length === 0) {
    const words = full.split(/\s+/).filter(Boolean);
    chapters = [];
    for (let i = 0, n = 1; i < words.length; i += CHUNK_WORDS, n++) {
      const slice = words.slice(i, i + CHUNK_WORDS);
      if (slice.length < MIN_WORDS) continue;
      const text = slice.join(' ');
      chapters.push({
        title: `Part ${n}`,
        paragraphs: paragraphsFromText(text) || [text],
        wordCount: slice.length,
      });
    }
  }

  return chapters;
}
