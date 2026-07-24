import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractLearningUnits,
  findLearningUnitAtTokenIndex,
} from '../src/lib/readingExposure';
import {
  createMemoryOccurrenceId,
  recordMemoryClickWithExposure,
  recordParagraphExposureWithRollback,
} from '../src/lib/memoryV2Integration';
import {
  aggregateArticleEvidence,
  getArticleGrade,
} from '../src/lib/memoryV2/evidenceAggregation';
import type { RawWordEvent } from '../src/lib/memoryV2/types';

const paragraph = 'Learners can recognize useful phrases over time.';
const highlightTerms = ['over time'];

function event(
  wordId: string,
  occurrenceId: string,
  eventType: RawWordEvent['eventType'],
): RawWordEvent {
  return {
    userId: 'test-user',
    wordId,
    articleId: 'article-1',
    occurrenceId,
    eventType,
    occurredAt: eventType === 'exposure'
      ? '2026-07-24T02:00:00.000Z'
      : '2026-07-24T02:00:01.000Z',
    localDate: '2026-07-24',
  };
}

test('highlighted phrase is one exposure unit and replaces its component-word units', () => {
  const units = extractLearningUnits(paragraph, highlightTerms);
  const phrase = units.find((unit) => unit.wordId === 'over time');

  assert.deepEqual(phrase, {
    wordId: 'over time',
    tokenIndex: 5,
    tokenLength: 2,
  });
  assert.equal(units.some((unit) => unit.wordId === 'over'), false);
  assert.equal(units.some((unit) => unit.wordId === 'time'), false);
});

test('clicking either rendered token of a phrase creates matching exposure and grades Again', async () => {
  const units = extractLearningUnits(paragraph, highlightTerms);
  const phraseExposure = units.find((unit) => unit.wordId === 'over time');
  const clickOnFirstToken = findLearningUnitAtTokenIndex(paragraph, highlightTerms, 5);
  const clickOnSecondToken = findLearningUnitAtTokenIndex(paragraph, highlightTerms, 6);

  assert.ok(phraseExposure);
  assert.deepEqual(clickOnFirstToken, phraseExposure);
  assert.deepEqual(clickOnSecondToken, phraseExposure);

  const exposureOccurrenceId = createMemoryOccurrenceId('article-1', 0, phraseExposure);
  const firstClickOccurrenceId = createMemoryOccurrenceId('article-1', 0, clickOnFirstToken!);
  const secondClickOccurrenceId = createMemoryOccurrenceId('article-1', 0, clickOnSecondToken!);

  assert.equal(firstClickOccurrenceId, exposureOccurrenceId);
  assert.equal(secondClickOccurrenceId, exposureOccurrenceId);

  const events: RawWordEvent[] = [];
  await recordMemoryClickWithExposure({
    articleId: 'article-1',
    paragraphIndex: 0,
    unit: clickOnSecondToken!,
    exposedOccurrenceIds: new Set(),
    recordExposure: async (wordId, _articleId, occurrenceId) => {
      events.push(event(wordId, occurrenceId, 'exposure'));
    },
    recordClick: async (wordId, _articleId, occurrenceId) => {
      events.push(event(wordId, occurrenceId, 'click'));
    },
  });

  const evidence = aggregateArticleEvidence(events);
  assert.ok(evidence);
  assert.equal(evidence.wordId, 'over time');
  assert.equal(evidence.validExposureCount, 1);
  assert.equal(evidence.clickedOccurrenceCount, 1);
  assert.equal(getArticleGrade(evidence), 'Again');
});

test('ordinary word exposure and click retain the same unit and occurrence id', () => {
  const units = extractLearningUnits(paragraph, highlightTerms);
  const exposure = units.find((unit) => unit.wordId === 'recognize');
  const click = findLearningUnitAtTokenIndex(paragraph, highlightTerms, 2);

  assert.ok(exposure);
  assert.deepEqual(click, exposure);
  assert.equal(
    createMemoryOccurrenceId('article-1', 0, click!),
    createMemoryOccurrenceId('article-1', 0, exposure),
  );
});

test('repeated ordinary words keep distinct occurrence ids and each click matches its exposure', () => {
  const repeatedParagraph = 'Practice makes practice reliable.';
  const units = extractLearningUnits(repeatedParagraph);
  const practiceUnits = units.filter((unit) => unit.wordId === 'practice');
  const secondClick = findLearningUnitAtTokenIndex(repeatedParagraph, [], 2);

  assert.deepEqual(practiceUnits, [
    { wordId: 'practice', tokenIndex: 0, tokenLength: 1 },
    { wordId: 'practice', tokenIndex: 2, tokenLength: 1 },
  ]);
  assert.deepEqual(secondClick, practiceUnits[1]);

  const firstOccurrenceId = createMemoryOccurrenceId('article-1', 0, practiceUnits[0]);
  const secondExposureId = createMemoryOccurrenceId('article-1', 0, practiceUnits[1]);
  const secondClickId = createMemoryOccurrenceId('article-1', 0, secondClick!);

  assert.notEqual(firstOccurrenceId, secondExposureId);
  assert.equal(secondClickId, secondExposureId);
});



test('failed paragraph exposure write rolls back occurrence ids so the batch can retry', async () => {
  const unit = extractLearningUnits(paragraph, highlightTerms).find(
    (item) => item.wordId === 'recognize',
  );
  assert.ok(unit);

  const exposedOccurrenceIds = new Set<string>();
  let attempts = 0;
  const recordExposures = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('storage unavailable');
  };

  await assert.rejects(
    recordParagraphExposureWithRollback({
      articleId: 'article-1',
      paragraphIndex: 0,
      units: [unit],
      exposedOccurrenceIds,
      recordExposures,
    }),
    /storage unavailable/,
  );
  assert.equal(exposedOccurrenceIds.size, 0);

  await recordParagraphExposureWithRollback({
    articleId: 'article-1',
    paragraphIndex: 0,
    units: [unit],
    exposedOccurrenceIds,
    recordExposures,
  });

  assert.equal(attempts, 2);
  assert.deepEqual([...exposedOccurrenceIds], [
    createMemoryOccurrenceId('article-1', 0, unit),
  ]);
});
