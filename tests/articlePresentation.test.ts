import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyArticleParagraph,
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
