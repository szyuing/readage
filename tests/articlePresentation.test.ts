import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyArticleParagraph,
  getArticleInlineParts,
} from '../src/lib/articlePresentation';

test('classifies an imported article title and byline for editorial layout', () => {
  assert.equal(
    classifyArticleParagraph(
      'ROBERT RAUSCHENBERG’S PENCHANT FOR INVENTION AND SPECTACLE',
      'Robert Rauschenberg\'s Penchant for Invention and Spectacle'
    ),
    'title'
  );
  assert.equal(
    classifyArticleParagraph('by Amy Weiss-Meyer', 'An article title'),
    'author'
  );
  assert.equal(
    classifyArticleParagraph('Byline: Elizabeth Kolbert', 'An article title'),
    'author'
  );
  assert.equal(
    classifyArticleParagraph('Author Jane Doe', 'An article title'),
    'author'
  );
  assert.equal(
    classifyArticleParagraph('The author argues for slower change.', 'An article title'),
    'body'
  );
});

test('separates safe article hyperlinks from surrounding prose', () => {
  assert.deepEqual(
    getArticleInlineParts('Read [the source](https://example.com/story), then visit https://openai.com/.'),
    [
      { type: 'text', value: 'Read ' },
      { type: 'link', value: 'the source', href: 'https://example.com/story' },
      { type: 'text', value: ', then visit ' },
      { type: 'link', value: 'https://openai.com/', href: 'https://openai.com/' },
      { type: 'text', value: '.' },
    ],
  );
});

test('classifies webpage navigation and separator lines as import furniture', () => {
  assert.equal(
    classifyArticleParagraph('| Next | Section menu | Main menu | Previous |', 'An article title'),
    'furniture'
  );
  assert.equal(classifyArticleParagraph('------------------------------', 'An article title'), 'furniture');
});

test('keeps normal article paragraphs in the reading flow', () => {
  assert.equal(
    classifyArticleParagraph('In 2007, the artists put a new twist on a famous sculpture.', 'An article title'),
    'body'
  );
});
