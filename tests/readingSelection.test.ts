import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSelectionQuote } from '../src/lib/readingSelection';

test('formats a selected sentence as a discussion quote', () => {
  assert.equal(formatSelectionQuote('  A useful sentence.  '), '> A useful sentence.\n\n');
});

test('appends a multi-line quote after an existing draft', () => {
  assert.equal(
    formatSelectionQuote('First line\nSecond line', 'Explain this'),
    'Explain this\n\n> First line\n> Second line\n\n',
  );
});

test('leaves the draft unchanged when the selection is empty', () => {
  assert.equal(formatSelectionQuote('   ', 'Existing draft'), 'Existing draft');
});
