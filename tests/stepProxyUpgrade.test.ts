import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';

import { attachStepRealtimeProxy } from '../server/realtime/stepProxy';

async function rejectedUpgradeStatus(
  env: Record<string, string | undefined>,
  path: string,
  origin?: string
): Promise<number> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const server = http.createServer();
  attachStepRealtimeProxy(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    return await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}${path}`, {
        headers: origin ? { Origin: origin } : undefined,
      });
      ws.once('unexpected-response', (_request, response) => {
        response.resume();
        resolve(response.statusCode || 0);
      });
      ws.once('open', () => {
        ws.close();
        reject(new Error('upgrade unexpectedly succeeded'));
      });
      ws.once('error', () => undefined);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('realtime upgrade rejects disabled, unauthorized, and cross-origin public access', async () => {
  assert.equal(
    await rejectedUpgradeStatus(
      { NODE_ENV: 'production', HOST: '0.0.0.0', APP_API_TOKEN: undefined },
      '/api/realtime/step'
    ),
    503
  );
  assert.equal(
    await rejectedUpgradeStatus(
      { NODE_ENV: 'production', HOST: '0.0.0.0', APP_API_TOKEN: 'secret' },
      '/api/realtime/step?token=wrong'
    ),
    401
  );
  assert.equal(
    await rejectedUpgradeStatus(
      {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        APP_API_TOKEN: 'secret',
        APP_ALLOWED_ORIGINS: 'https://app.example',
      },
      '/api/realtime/step?token=secret',
      'https://evil.example'
    ),
    403
  );
});

async function acceptedThenClosedCode(
  env: Record<string, string | undefined>,
  path: string
): Promise<number> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const server = http.createServer();
  attachStepRealtimeProxy(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    return await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for realtime close')), 2_000);
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}${path}`);
      ws.once('close', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
      ws.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('invalid realtime upstream configuration closes only the affected client', async () => {
  assert.equal(
    await acceptedThenClosedCode(
      {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        STEP_API_KEY: 'test-key',
        STEP_REALTIME_URL: 'not-a-websocket-url',
      },
      '/api/realtime/step'
    ),
    1011
  );
});
