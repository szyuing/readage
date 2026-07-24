import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMemoryStopWord,
  shouldTrackMemoryWord,
} from '../src/lib/memoryV2/stopWords';

describe('Memory stop-word policy', () => {
  it('classifies common function words as stop words', () => {
    assert.equal(isMemoryStopWord('the'), true);
    assert.equal(isMemoryStopWord('and'), true);
    assert.equal(isMemoryStopWord('with'), true);
    assert.equal(isMemoryStopWord('patient'), false);
  });

  it('never treats multi-word phrases as stop words', () => {
    assert.equal(isMemoryStopWord('over time'), false);
    assert.equal(shouldTrackMemoryWord('over time'), true);
  });

  it('allowlists highlighted terms even when they are function words', () => {
    assert.equal(shouldTrackMemoryWord('the'), false);
    assert.equal(shouldTrackMemoryWord('the', new Set(['the'])), true);
  });
});
