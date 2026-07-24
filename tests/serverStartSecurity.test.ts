import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>;
};

test('npm start forces production mode without shell-specific environment syntax', () => {
  const start = packageJson.scripts.start;
  assert.match(start, /NODE_ENV/);
  assert.match(start, /production/);
  assert.doesNotMatch(start, /(^|\s)(set\s+|export\s+|NODE_ENV=production\s)/i);
});
