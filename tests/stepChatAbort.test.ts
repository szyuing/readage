import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStepAbortSignal,
  getStepTranslateModel,
  getStepTranslateReasoningEffort,
} from '../server/llm/stepChat';

test('Step request signal propagates caller cancellation', () => {
  const outer = new AbortController();
  const linked = createStepAbortSignal(outer.signal, 5_000);
  outer.abort();
  assert.equal(linked.signal.aborted, true);
  linked.cleanup();
});

test('Step request signal enforces a provider timeout', async () => {
  const linked = createStepAbortSignal(undefined, 5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(linked.signal.aborted, true);
  linked.cleanup();
});

test('translation LLM defaults to step-3.7-flash with low reasoning effort', () => {
  const prevModel = process.env.STEP_TRANSLATE_MODEL;
  const prevEffort = process.env.STEP_TRANSLATE_REASONING_EFFORT;
  const prevChat = process.env.STEP_CHAT_MODEL;
  try {
    delete process.env.STEP_TRANSLATE_MODEL;
    delete process.env.STEP_TRANSLATE_REASONING_EFFORT;
    delete process.env.STEP_CHAT_MODEL;
    assert.equal(getStepTranslateModel(), 'step-3.7-flash');
    assert.equal(getStepTranslateReasoningEffort(), 'low');

    process.env.STEP_TRANSLATE_MODEL = 'step-3.7-flash';
    process.env.STEP_TRANSLATE_REASONING_EFFORT = 'LOW';
    assert.equal(getStepTranslateModel(), 'step-3.7-flash');
    assert.equal(getStepTranslateReasoningEffort(), 'low');

    process.env.STEP_TRANSLATE_REASONING_EFFORT = 'bogus';
    assert.equal(getStepTranslateReasoningEffort(), 'low');
  } finally {
    if (prevModel === undefined) delete process.env.STEP_TRANSLATE_MODEL;
    else process.env.STEP_TRANSLATE_MODEL = prevModel;
    if (prevEffort === undefined) delete process.env.STEP_TRANSLATE_REASONING_EFFORT;
    else process.env.STEP_TRANSLATE_REASONING_EFFORT = prevEffort;
    if (prevChat === undefined) delete process.env.STEP_CHAT_MODEL;
    else process.env.STEP_CHAT_MODEL = prevChat;
  }
});
