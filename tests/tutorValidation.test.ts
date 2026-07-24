import assert from 'node:assert/strict';
import test from 'node:test';

import { validateTutorRequest } from '../src/lib/tutorValidation';

test('accepts a known tutor intent and bounds discussion history', () => {
  const history = Array.from({ length: 20 }, (_, index) => ({
    id: String(index),
    sender: index % 2 ? 'ai' as const : 'user' as const,
    text: `message ${index}`,
    timestamp: '2026-07-23T00:00:00.000Z',
  }));

  const result = validateTutorRequest({
    intent: 'discuss',
    message: 'What is the main idea?',
    history,
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.history?.length, 12);
});

test('rejects removed writing intent, unknown intents, and oversized fields', () => {
  assert.equal(validateTutorRequest({ intent: 'writing_feedback' }).ok, false);
  assert.equal(validateTutorRequest({ intent: 'delete_everything' }).ok, false);
  const result = validateTutorRequest({ intent: 'explain', selectedText: 'x'.repeat(2001) });
  assert.equal(result.ok, false);
});

test('accepts rate_article and paragraph translation metadata', () => {
  const rate = validateTutorRequest({
    intent: 'rate_article',
    articleContext: 'This is a short sample article for CEFR rating.',
    topic: 'Sample',
  });
  assert.equal(rate.ok, true);

  const translate = validateTutorRequest({
    intent: 'translate',
    message: 'A full paragraph of English text for import translation.',
    targetLanguage: 'Chinese',
    paragraphIndex: 2,
    paragraphTotal: 5,
  });
  assert.equal(translate.ok, true);
  if (translate.ok) {
    assert.equal(translate.value.paragraphIndex, 2);
    assert.equal(translate.value.paragraphTotal, 5);
  }
});
