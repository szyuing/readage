import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expandLemmaIndexToCandidates, type MagazineLemmaIndex } from '../src/lib/magazineLemmaIndex';

describe('magazine lemma index candidate expansion', () => {
  it('preserves indexed word count for cold-start length scoring', () => {
    const index: MagazineLemmaIndex = {
      version: 1,
      fingerprint: 'test',
      builtAt: '2026-07-25T00:00:00.000Z',
      articleCount: 1,
      vocab: ['policy', 'trade'],
      articles: [{
        id: 'mag:one',
        title: 'Trade policy',
        level: 'B2',
        wordCount: 320,
        lemmaIndices: [0, 1],
      }],
    };

    const [candidate] = expandLemmaIndexToCandidates(index);
    assert.equal(candidate?.article.estimatedWordCount, 320);
  });
});
