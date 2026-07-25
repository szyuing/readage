import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAppPath, parseAppPath } from '../src/lib/appRoutes';

test('parses the recommendation entry and supported page paths', () => {
  assert.deepEqual(parseAppPath('/'), { kind: 'recommendation' });
  assert.deepEqual(parseAppPath('/library'), { kind: 'library' });
  assert.deepEqual(parseAppPath('/assessment'), { kind: 'assessment' });
  assert.deepEqual(parseAppPath('/learning'), { kind: 'learning' });
  assert.deepEqual(parseAppPath('/history'), { kind: 'history' });
});

test('round-trips encoded article ids', () => {
  const route = { kind: 'reading' as const, articleId: 'magazine/issue 1' };

  assert.equal(buildAppPath(route), '/read/magazine%2Fissue%201');
  assert.deepEqual(parseAppPath(buildAppPath(route)), route);
});

test('normalizes trailing slashes and falls back unknown paths to recommendation', () => {
  assert.deepEqual(parseAppPath('/library/'), { kind: 'library' });
  assert.deepEqual(parseAppPath('/not-a-page'), { kind: 'recommendation' });
  assert.deepEqual(parseAppPath('/read/'), { kind: 'recommendation' });
});

test('builds stable paths for every route kind', () => {
  assert.equal(buildAppPath({ kind: 'recommendation' }), '/');
  assert.equal(buildAppPath({ kind: 'library' }), '/library');
  assert.equal(buildAppPath({ kind: 'assessment' }), '/assessment');
  assert.equal(buildAppPath({ kind: 'learning' }), '/learning');
  assert.equal(buildAppPath({ kind: 'history' }), '/history');
});
