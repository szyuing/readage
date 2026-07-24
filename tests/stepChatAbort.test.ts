import assert from 'node:assert/strict';
import test from 'node:test';

import { createStepAbortSignal } from '../server/llm/stepChat';

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
