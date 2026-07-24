import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  createStepAbortSignal,
  getDeepSeekBaseUrl,
  getDeepSeekTranslateModel,
  stepGenerateJson,
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

test('translation LLM defaults to DeepSeek V4 Flash without reasoning', () => {
  const prevModel = process.env.DEEPSEEK_TRANSLATE_MODEL;
  const prevBaseUrl = process.env.DEEPSEEK_BASE_URL;
  try {
    delete process.env.DEEPSEEK_TRANSLATE_MODEL;
    delete process.env.DEEPSEEK_BASE_URL;
    assert.equal(getDeepSeekTranslateModel(), 'deepseek-v4-flash');
    assert.equal(getDeepSeekBaseUrl(), 'https://api.deepseek.com');

    process.env.DEEPSEEK_TRANSLATE_MODEL = 'custom-model';
    process.env.DEEPSEEK_BASE_URL = 'https://example.test/v1/';
    assert.equal(getDeepSeekTranslateModel(), 'custom-model');
    assert.equal(getDeepSeekBaseUrl(), 'https://example.test/v1');
  } finally {
    if (prevModel === undefined) delete process.env.DEEPSEEK_TRANSLATE_MODEL;
    else process.env.DEEPSEEK_TRANSLATE_MODEL = prevModel;
    if (prevBaseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = prevBaseUrl;
  }
});

test('DeepSeek translation requests explicitly disable thinking', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requestBody = JSON.parse(body) as Record<string, unknown>;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousBaseUrl = process.env.DEEPSEEK_BASE_URL;
  try {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${address.port}`;
    const result = await stepGenerateJson<{ ok: boolean }>('Translate this.', {
      provider: 'deepseek',
      reasoningEffort: 'high',
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(requestBody?.model, 'deepseek-v4-flash');
    assert.equal('reasoning_effort' in (requestBody || {}), false);
    assert.deepEqual(requestBody?.thinking, { type: 'disabled' });
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    if (previousBaseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = previousBaseUrl;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('DeepSeek translations use a dedicated 50-request concurrency pool', async () => {
  let active = 0;
  let maxActive = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        active -= 1;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
      }, 20);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousBaseUrl = process.env.DEEPSEEK_BASE_URL;
  try {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${address.port}`;
    await Promise.all(
      Array.from({ length: 55 }, (_, index) =>
        stepGenerateJson<{ ok: boolean }>(`Translate article ${index}.`, {
          provider: 'deepseek',
        })
      )
    );
    assert.equal(maxActive, 50);
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    if (previousBaseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = previousBaseUrl;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
