import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  makeArticleId,
  makeIssueId,
  parseIssueLabel,
  shouldSyncOnBoot,
  slugify,
} from '../server/magazines/config';
import { parseEpubBuffer } from '../server/magazines/parseEpub';
import { chaptersToArticles } from '../server/magazines/normalize';
import { mergeConfiguredSourceSummaries } from '../server/magazines/store';

describe('magazine config helpers', () => {
  it('parses economist-style issue folders', () => {
    assert.equal(parseIssueLabel('te_2026.07.18'), '2026.07.18');
    assert.equal(parseIssueLabel('2026.01.05'), '2026.01.05');
    assert.equal(parseIssueLabel('tny_2026-03-10'), '2026.03.10');
  });

  it('builds stable issue and article ids', () => {
    assert.equal(makeIssueId('economist', '2026.07.18'), 'economist:2026.07.18');
    const id = makeArticleId('economist', '2026.07.18', 'Leaders: Climate', 0);
    assert.ok(id.startsWith('mag:economist:2026.07.18:'));
    assert.ok(id.includes('leaders-climate'));
  });

  it('slugifies titles', () => {
    assert.equal(slugify('Hello, World!'), 'hello-world');
  });

  it('defaults to full-source sync on boot', () => {
    const prev = process.env.MAGAZINE_SYNC_ON_BOOT;
    try {
      delete process.env.MAGAZINE_SYNC_ON_BOOT;
      assert.equal(shouldSyncOnBoot(), true);
      process.env.MAGAZINE_SYNC_ON_BOOT = 'false';
      assert.equal(shouldSyncOnBoot(), false);
      process.env.MAGAZINE_SYNC_ON_BOOT = 'true';
      assert.equal(shouldSyncOnBoot(), true);
    } finally {
      if (prev === undefined) delete process.env.MAGAZINE_SYNC_ON_BOOT;
      else process.env.MAGAZINE_SYNC_ON_BOOT = prev;
    }
  });
});

describe('magazine source catalog', () => {
  it('keeps newly configured sources visible in an older persisted index', () => {
    const sources = mergeConfiguredSourceSummaries([
      {
        id: 'wired',
        displayName: 'Old Wired label',
        levelHint: 'B2',
        topic: 'Technology',
        issueCount: 4,
      },
    ]);

    assert.equal(sources.find((source) => source.id === 'wired')?.issueCount, 4);
    assert.equal(sources.find((source) => source.id === 'news_in_levels_a2')?.levelHint, 'A2');
    assert.equal(sources.find((source) => source.id === 'news_in_levels_b1')?.levelHint, 'B1');
  });
});

describe('epub parser', () => {
  it('extracts chapters from a minimal epub fixture', async () => {
    const zip = new JSZip();
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?>
      <container>
        <rootfiles>
          <rootfile full-path="OEBPS/content.opf"/>
        </rootfiles>
      </container>`
    );
    zip.file(
      'OEBPS/content.opf',
      `<?xml version="1.0"?>
      <package>
        <manifest>
          <item id="c1" href="c1.xhtml"/>
          <item id="c2" href="c2.xhtml"/>
          <item id="nav" href="nav.xhtml"/>
        </manifest>
        <spine>
          <itemref idref="nav"/>
          <itemref idref="c1"/>
          <itemref idref="c2"/>
        </spine>
      </package>`
    );
    zip.file(
      'OEBPS/nav.xhtml',
      `<html><head><title>Contents</title></head><body><h1>Contents</h1><p>Table of contents page only.</p></body></html>`
    );
    const longBody = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about global trade and policy.`).join(' ');
    zip.file(
      'OEBPS/c1.xhtml',
      `<html><head><title>Trade winds</title></head><body>
        <h1>Trade winds</h1>
        <p>${longBody}</p>
        <p>Further analysis continues in the second paragraph with more economic detail for learners.</p>
      </body></html>`
    );
    zip.file(
      'OEBPS/c2.xhtml',
      `<html><body>
        <h1>Climate agenda</h1>
        <p>${longBody} Additional remarks on emissions targets and international cooperation.</p>
        <p>Readers should note the political constraints described here.</p>
      </body></html>`
    );

    const buffer = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
    const chapters = await parseEpubBuffer(buffer);
    assert.ok(chapters.length >= 2, `expected >=2 chapters, got ${chapters.length}`);
    assert.ok(chapters.some((c) => /trade/i.test(c.title)));
    assert.ok(chapters.every((c) => c.wordCount >= 80));

    const articles = chaptersToArticles(
      chapters,
      {
        id: 'economist',
        repoDir: '01_economist',
        displayName: 'The Economist',
        levelHint: 'C1',
      },
      '2026.07.18'
    );
    assert.equal(articles[0].source, 'magazine');
    assert.equal(articles[0].magazineIssueId, 'economist:2026.07.18');
    assert.ok(articles[0].content.length >= 1);
  });
});
