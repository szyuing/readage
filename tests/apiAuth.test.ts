import assert from 'node:assert/strict';
import test from 'node:test';

import { getApiAuthHeaders, getJsonApiHeaders } from '../src/lib/apiAuth';

test('api auth headers are empty when no client token is configured', () => {
  assert.deepEqual(getApiAuthHeaders(), {});
  assert.deepEqual(getJsonApiHeaders(), { 'Content-Type': 'application/json' });
});

test('json api headers keep content-type and allow extras', () => {
  assert.deepEqual(getJsonApiHeaders({ 'X-Custom': '1' }), {
    'Content-Type': 'application/json',
    'X-Custom': '1',
  });
});
