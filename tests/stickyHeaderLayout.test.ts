import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('page shells preserve sticky headers by avoiding hidden overflow scroll containers', () => {
  const globalStyles = readFileSync(resolve(repoRoot, 'src/index.css'), 'utf8');
  const appSource = readFileSync(resolve(repoRoot, 'src/App.tsx'), 'utf8');
  const readingSource = readFileSync(
    resolve(repoRoot, 'src/components/ReadingScreen.tsx'),
    'utf8',
  );

  assert.match(globalStyles, /body\s*\{[\s\S]*?overflow-x:\s*clip;/);
  assert.match(appSource, /flex flex-col overflow-x-clip safe-px/);
  assert.match(readingSource, /ease-out overflow-x-clip/);
});

test('the collapsed discussion button stays in the viewport bottom-right at every breakpoint', () => {
  const readingSource = readFileSync(
    resolve(repoRoot, 'src/components/ReadingScreen.tsx'),
    'utf8',
  );
  const buttonMatch = readingSource.match(
    /className="([^"]+)"\s+aria-label="Open article discussion input"/,
  );

  assert.ok(buttonMatch, 'collapsed discussion button should be present');
  assert.match(buttonMatch[1], /right-\[max\(1rem,env\(safe-area-inset-right,0px\)\)\]/);
  assert.match(buttonMatch[1], /bottom-\[max\(1\.25rem,calc\(1rem\+env\(safe-area-inset-bottom,0px\)\)\)\]/);
  assert.doesNotMatch(buttonMatch[1], /sm:bottom-auto|sm:top-1\/2|sm:-translate-y-1\/2/);
});
