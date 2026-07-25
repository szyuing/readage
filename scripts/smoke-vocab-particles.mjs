/**
 * Smoke test: real-shaped Memory V2 vocab events → debug bus → poll.
 * Usage: node scripts/smoke-vocab-particles.mjs
 */

const API = process.env.REC_API || 'http://127.0.0.1:3000';

async function post(event) {
  const res = await fetch(`${API}/api/debug/recommendation-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`POST ${event.type} ${res.status}`);
  return res.json();
}

async function main() {
  const sessionId = `vocab-smoke-${Date.now().toString(36)}`;
  const t0 = Date.now();
  const words = [
    { wordId: 'habit', memoryScore: 22, level: 1 },
    { wordId: 'compound', memoryScore: 48, level: 2 },
    { wordId: 'signal', memoryScore: 12, level: 0 },
  ];

  await post({
    type: 'vocab_session',
    sessionId,
    at: t0,
    articleId: 'article-smoke-1',
    dueWords: words,
  });
  await post({
    type: 'vocab_exposure',
    sessionId,
    at: t0 + 50,
    articleId: 'article-smoke-1',
    paragraphIndex: 0,
    words,
  });
  await post({
    type: 'vocab_click',
    sessionId,
    at: t0 + 100,
    articleId: 'article-smoke-1',
    paragraphIndex: 0,
    word: { wordId: 'habit', memoryScore: 18, level: 1 },
  });
  await post({
    type: 'vocab_article_complete',
    sessionId,
    at: t0 + 200,
    articleId: 'article-smoke-1',
    exposedLemmas: words.map((w) => w.wordId),
    words,
  });

  const res = await fetch(`${API}/api/debug/recommendation-events?since=${t0 - 1}`);
  const payload = await res.json();
  const mine = (payload.events || []).filter((e) => e.sessionId === sessionId);
  const types = mine.map((e) => e.type);
  const ok =
    types.includes('vocab_session')
    && types.includes('vocab_exposure')
    && types.includes('vocab_click')
    && types.includes('vocab_article_complete');

  console.log(ok ? 'PASS' : 'FAIL', 'vocab pipeline', types.join(','));
  console.log('Open http://localhost:5177/?mode=vocab — should show habit flash + complete');
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
