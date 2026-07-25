/**
 * End-to-end smoke for rec-particles telemetry bridge.
 * Posts a full real-shaped pipeline to the main app debug buffer,
 * then verifies poll + that the particle page is reachable.
 *
 * Usage: node scripts/smoke-rec-particles.mjs
 */

const API = process.env.REC_API || 'http://127.0.0.1:3000';
const PARTICLES = process.env.REC_PARTICLES || 'http://localhost:5177';

async function post(event) {
  const res = await fetch(`${API}/api/debug/recommendation-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${event.type} → ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

async function getSince(since) {
  const res = await fetch(`${API}/api/debug/recommendation-events?since=${since}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET events → ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const failures = [];
  const report = (name, ok, detail = '') => {
    const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`;
    console.log(line);
    if (!ok) failures.push(line);
  };

  // 1. Health
  try {
    const health = await fetch(`${API}/api/health`).then((r) => r.json());
    report('main /api/health', health.ok === true, JSON.stringify(health));
  } catch (e) {
    report('main /api/health', false, String(e.message || e));
    console.error('\nMain app not running. Start: npm run dev');
    process.exit(1);
  }

  // 2. Particle page
  try {
    const page = await fetch(PARTICLES);
    const html = await page.text();
    report(
      'particles page HTTP',
      page.ok && (html.includes('Learning Particles') || html.includes('Recommended Reading')),
      `status=${page.status}`
    );
    report(
      'particles default is real (not auto-demo)',
      !html.includes('Demo 模式') || html.includes('真实'),
      'index should wait for live data'
    );
  } catch (e) {
    report('particles page HTTP', false, String(e.message || e));
  }

  // 3. Full pipeline POST
  const sessionId = `smoke-${Date.now().toString(36)}`;
  const t0 = Date.now();
  const reviewWords = ['habit', 'compound', 'signal', 'quiet'];
  const items = Array.from({ length: 12 }, (_, i) => ({
    id: `mag-smoke-${i}`,
    title: i === 0 ? 'How habits compound (smoke winner)' : `Smoke candidate #${i + 1}`,
    score: 100 - i * 3.5,
    dueWordsCount: Math.max(0, 4 - Math.floor(i / 2)),
    learningZoneCount: 8 + i,
    cefrRelation: i % 2 === 0 ? 'exact' : 'adjacent-higher',
    reason: i === 0 ? '命中 3 个到期单词，匹配 B1' : '接近当前水平',
    reviewHits: i === 0 ? ['habit', 'compound', 'signal'] : i < 3 ? ['habit'] : [],
  }));

  const pipeline = [
    {
      type: 'session_start',
      sessionId,
      at: t0,
      topic: 'English Idioms & Daily Practice',
      reviewWords,
      userLevel: 'B1',
    },
    { type: 'phase', sessionId, at: t0 + 10, phase: 'catalog' },
    {
      type: 'catalog_loaded',
      sessionId,
      at: t0 + 40,
      catalogSize: 681,
      loadMs: 12,
    },
    {
      type: 'pool_ready',
      sessionId,
      at: t0 + 80,
      poolSize: 620,
      excludedCount: 61,
    },
    {
      type: 'candidates',
      sessionId,
      at: t0 + 200,
      items,
      totalScored: 620,
      shortlistSize: items.length,
      reviewWords,
    },
    {
      type: 'picked',
      sessionId,
      at: t0 + 400,
      articleId: items[0].id,
      title: items[0].title,
      source: 'full_catalog',
      totalMs: 420,
      score: items[0].score,
      rank: 1,
      reviewHits: items[0].reviewHits,
      reason: items[0].reason,
    },
  ];

  try {
    for (const event of pipeline) {
      await post(event);
    }
    report('POST full pipeline (6 events)', true, sessionId);
  } catch (e) {
    report('POST full pipeline (6 events)', false, String(e.message || e));
  }

  // 4. Poll back
  try {
    const payload = await getSince(t0 - 1);
    assert(payload.ok, 'payload.ok');
    const mine = (payload.events || []).filter((e) => e.sessionId === sessionId);
    const types = mine.map((e) => e.type);
    report(
      'GET poll returns session events',
      types.includes('session_start')
        && types.includes('candidates')
        && types.includes('picked'),
      `got=${types.join(',')}`
    );
    const start = mine.find((e) => e.type === 'session_start');
    report(
      'real reviewWords preserved',
      Array.isArray(start?.reviewWords)
        && start.reviewWords.join(',') === reviewWords.join(','),
      JSON.stringify(start?.reviewWords)
    );
    const picked = mine.find((e) => e.type === 'picked');
    report(
      'picked is real winner payload',
      picked?.articleId === items[0].id
        && picked?.title?.includes('smoke winner')
        && Array.isArray(picked?.reviewHits)
        && picked.reviewHits.includes('habit'),
      JSON.stringify({
        id: picked?.articleId,
        title: picked?.title,
        hits: picked?.reviewHits,
        score: picked?.score,
      })
    );
    const cands = mine.find((e) => e.type === 'candidates');
    report(
      'candidates carry totalScored + hits',
      cands?.totalScored === 620
        && cands?.items?.[0]?.reviewHits?.includes('compound'),
      `totalScored=${cands?.totalScored} firstHits=${JSON.stringify(cands?.items?.[0]?.reviewHits)}`
    );
  } catch (e) {
    report('GET poll returns session events', false, String(e.message || e));
  }

  // 5. SSE endpoint opens
  try {
    const res = await fetch(`${API}/api/debug/recommendation-stream`, {
      headers: { Accept: 'text/event-stream' },
    });
    report(
      'SSE stream endpoint',
      res.ok && (res.headers.get('content-type') || '').includes('text/event-stream'),
      `status=${res.status} ct=${res.headers.get('content-type')}`
    );
    // Don't hang reading forever — abort body
    try {
      await res.body?.cancel();
    } catch {
      // ignore
    }
  } catch (e) {
    report('SSE stream endpoint', false, String(e.message || e));
  }

  // 6. CORS headers for particle origin
  try {
    const res = await fetch(`${API}/api/debug/recommendation-events?since=0`, {
      headers: { Origin: 'http://localhost:5177' },
    });
    const acao = res.headers.get('access-control-allow-origin');
    report('CORS Allow-Origin for :5177', acao === '*' || acao === 'http://localhost:5177', `acao=${acao}`);
  } catch (e) {
    report('CORS Allow-Origin for :5177', false, String(e.message || e));
  }

  console.log('\n---');
  if (failures.length) {
    console.log(`RESULT: FAIL (${failures.length})`);
    process.exit(1);
  }
  console.log('RESULT: PASS');
  console.log(`\nOpen ${PARTICLES} now — you should see Live animation for session ${sessionId}`);
  console.log('(If already open, wait ≤1s for poll, or hard-refresh.)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
