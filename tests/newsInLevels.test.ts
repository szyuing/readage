import test from 'node:test';
import assert from 'node:assert/strict';
import { getSourceById } from '../server/magazines/config';
import {
  discoverNewsInLevelsIssues,
  parseNewsInLevelsArticle,
} from '../server/magazines/newsInLevels';

test('configures News in Levels Level 1 as A2 and Level 2 as B1 sources', () => {
  const a2 = getSourceById('news_in_levels_a2');
  const b1 = getSourceById('news_in_levels_b1');

  assert.equal(a2?.levelHint, 'A2');
  assert.equal(a2?.provider, 'news_in_levels');
  assert.equal(b1?.levelHint, 'B1');
  assert.equal(b1?.provider, 'news_in_levels');
});

test('extracts only the News in Levels article body', () => {
  const parsed = parseNewsInLevelsArticle(`
    <html>
      <body>
        <nav>Navigation should not appear.</nav>
        <div class="article-title"><h2>A Small Helpful Story - level 1</h2></div>
        <div id="nContent">
          <p>25-07-2026 12:00</p>
          <p>People help each other in a small town. The story has enough words for reading practice.</p>
          <p>The helpers feel happy after the work is complete.</p>
        </div>
        <footer>Advertising and footer text should not appear.</footer>
      </body>
    </html>
  `);

  assert.equal(parsed.title, 'A Small Helpful Story - level 1');
  assert.equal(parsed.date, '2026.07.25');
  assert.deepEqual(parsed.paragraphs, [
    'People help each other in a small town. The story has enough words for reading practice.',
    'The helpers feel happy after the work is complete.',
  ]);
});

test('discovers level-matched product pages and creates HTML issue candidates', async () => {
  const source = getSourceById('news_in_levels_a2');
  assert.ok(source?.sourceUrl);

  const indexUrl = source.sourceUrl;
  const articleUrl = 'https://www.newsinlevels.com/products/helpful-story-level-1/';
  const wrongLevelUrl = 'https://www.newsinlevels.com/products/helpful-story-level-2/';
  const page = `
    <h2 class="article-title">Helpful Story - level 1</h2>
    <div id="nContent">
      <p>25-07-2026 12:00</p>
      <p>People help each other in a small town. The story has enough words for reading practice.</p>
    </div>
  `;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url === indexUrl) {
      return new Response(
        `<a href="${articleUrl}">Helpful Story - level 1</a><a href="${articleUrl.slice(0, -1)}">Duplicate</a><a href="${wrongLevelUrl}">Wrong level</a>`,
        { status: 200 }
      );
    }
    if (url === articleUrl) return new Response(page, { status: 200 });
    return new Response('not found', { status: 404 });
  };

  const candidates = await discoverNewsInLevelsIssues(source, 10, { fetchImpl });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.format, 'html');
  assert.match(candidates[0]?.issueLabel || '', /^2026\.07\.25-helpful-story$/);
  assert.equal(candidates[0]?.content, page);
  assert.equal(candidates[0]?.preferredFile.download_url, articleUrl);
});
