import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhraseHighlightMatches } from '../src/lib/textHighlight';

test('highlights exact words and phrase ranges without matching common substrings', () => {
  const tokens = 'Learning a new phrase can help you break a leg on stage.'.split(/\s+/);
  const matches = getPhraseHighlightMatches(tokens, ['break a leg', 'phrase']);

  assert.equal(matches[1], null, 'the unrelated article "a" must not be highlighted');
  assert.equal(matches[3], 'phrase');

  const breakIndex = tokens.indexOf('break');
  assert.deepEqual(matches.slice(breakIndex, breakIndex + 3), [
    'break a leg',
    'break a leg',
    'break a leg',
  ]);
});

test('matches punctuation-wrapped terms using normalized word boundaries', () => {
  const tokens = "Words like 'ephemeral,' remain useful.".split(/\s+/);
  const matches = getPhraseHighlightMatches(tokens, ['ephemeral']);
  assert.equal(matches[2], 'ephemeral');
});
