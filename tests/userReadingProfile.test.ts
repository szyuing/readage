import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCefrRecommendationProfile,
  cefrBandDistance,
  cefrLevelMatchMultiplier,
  getCefrRelation,
  normalizeUserReadingAssessment,
  preferredRewriteLevels,
  projectBandsOntoCatalog,
  resolveUserCefrLevel,
  suggestedWordCountRange,
} from '../src/lib/userReadingProfile';

describe('userReadingProfile bridge', () => {
  it('resolves assessed band and falls back to B1', () => {
    assert.equal(resolveUserCefrLevel({ recommendedBand: 'C1' }), 'C1');
    assert.equal(resolveUserCefrLevel(null), 'B1');
    assert.equal(resolveUserCefrLevel({ recommendedBand: 'nope' }), 'B1');
  });

  it('normalizes persisted assessment payloads', () => {
    const ok = normalizeUserReadingAssessment({
      recommendedBand: 'b2',
      inferredBand: 'B1',
      totalCorrect: 4.8,
      adjustment: 'up',
      completedAt: '2026-07-24T00:00:00.000Z',
    });
    assert.deepEqual(ok, {
      recommendedBand: 'B2',
      inferredBand: 'B1',
      totalCorrect: 4,
      adjustment: 'up',
      completedAt: '2026-07-24T00:00:00.000Z',
    });
    assert.equal(normalizeUserReadingAssessment({ recommendedBand: 'B2' }), null);
  });

  it('boosts exact and adjacent CEFR matches for recommendations', () => {
    assert.equal(cefrBandDistance('B2', 'B2'), 0);
    assert.equal(cefrBandDistance('B1', 'B2'), 1);
    assert.ok(cefrLevelMatchMultiplier('B2', 'B2') > cefrLevelMatchMultiplier('B1', 'B2'));
    assert.ok(cefrLevelMatchMultiplier('B1', 'B2') > cefrLevelMatchMultiplier('A1', 'B2'));
  });

  it('suggests rewrite targets near the assessed band', () => {
    assert.deepEqual(preferredRewriteLevels('B2'), ['B2', 'B1', 'C1']);
    assert.equal(suggestedWordCountRange('B1').label, '180–300 词');
  });

  it('builds a low-weight default profile when no assessment exists', () => {
    assert.deepEqual(buildCefrRecommendationProfile(null), {
      userLevel: 'B1',
      hasAssessment: false,
      confidence: 'low',
      idealBands: ['B1', 'B2'],
      stretchBand: 'B2',
      cefrWeight: 0.4,
      preferShorter: true,
    });
  });

  it('derives recommendation confidence from a completed assessment', () => {
    const high = buildCefrRecommendationProfile({
      recommendedBand: 'B2',
      inferredBand: 'B2',
      totalCorrect: 5,
      adjustment: 'same',
      completedAt: '2026-07-25T00:00:00.000Z',
    });
    const medium = buildCefrRecommendationProfile({
      recommendedBand: 'C1',
      inferredBand: 'B2',
      totalCorrect: 5,
      adjustment: 'up',
      completedAt: '2026-07-25T00:00:00.000Z',
    });
    const low = buildCefrRecommendationProfile({
      recommendedBand: 'A2',
      inferredBand: 'B1',
      totalCorrect: 2,
      adjustment: 'down',
      completedAt: '2026-07-25T00:00:00.000Z',
    });

    assert.equal(high.confidence, 'high');
    assert.equal(high.cefrWeight, 1.3);
    assert.equal(medium.confidence, 'medium');
    assert.equal(medium.cefrWeight, 1);
    assert.equal(low.confidence, 'low');
    assert.equal(low.cefrWeight, 0.7);
  });

  it('projects ideal bands onto the closest levels actually available', () => {
    assert.deepEqual(projectBandsOntoCatalog(['A2', 'B1'], ['B2', 'C1']), ['B2']);
    assert.deepEqual(projectBandsOntoCatalog(['B1', 'B2'], ['B2', 'C1']), ['B2']);
    assert.deepEqual(projectBandsOntoCatalog(['C2', 'C1'], ['B2', 'C1']), ['C1']);
    assert.deepEqual(projectBandsOntoCatalog(['B1', 'B2'], []), []);
  });

  it('distinguishes easier and harder CEFR neighbors', () => {
    assert.equal(getCefrRelation('B2', 'B1'), 'adjacent-higher');
    assert.equal(getCefrRelation('A2', 'B1'), 'adjacent-lower');
    assert.equal(getCefrRelation('C1', 'B1'), 'far-higher');
    assert.equal(getCefrRelation(undefined, 'B1'), 'unknown');
  });
});
