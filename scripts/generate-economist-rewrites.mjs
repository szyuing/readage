/**
 * Generate a fixed pool of A1/A2 reading articles from Economist sources.
 *
 * The source files are immutable. Generated records are written to the normal
 * magazine catalog under a synthetic AI issue and can be resumed safely.
 *
 * Env:
 *   APP_URL=http://127.0.0.1:3000
 *   ECONOMIST_REWRITE_A1=50
 *   ECONOMIST_REWRITE_A2=50
 *   ECONOMIST_REWRITE_CONCURRENCY=20
 *   ECONOMIST_REWRITE_ISSUE=ai-rewrites-v1
 *   ECONOMIST_REWRITE_DRY_RUN=1
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  buildGeneratedArticle,
  buildRewriteIssue,
  buildRewriteJobs,
  makeRewriteArticleId,
  selectEconomistSources,
} from './economist-rewrite-utils.mjs';

const ROOT = process.cwd();
const ARTICLES_DIR = path.join(ROOT, 'data', 'magazines', 'articles_by_id');
const ISSUES_DIR = path.join(ROOT, 'data', 'magazines', 'issues');
const INDEX_FILE = path.join(ROOT, 'data', 'magazines', 'index.json');
const PROGRESS_FILE = path.join(ROOT, 'local-data', 'economist-rewrites-progress.json');
const LOG_FILE = path.join(ROOT, 'local-data', 'economist-rewrites.log');
const BASE = (process.env.APP_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const A1_COUNT = Math.max(0, Math.floor(Number(process.env.ECONOMIST_REWRITE_A1 || 50)));
const A2_COUNT = Math.max(0, Math.floor(Number(process.env.ECONOMIST_REWRITE_A2 || 50)));
const CONCURRENCY = Math.max(1, Math.min(50, Math.floor(Number(process.env.ECONOMIST_REWRITE_CONCURRENCY || 20))));
const ISSUE_VERSION = (process.env.ECONOMIST_REWRITE_ISSUE || 'ai-rewrites-v1').trim().replace(/[^a-zA-Z0-9._-]/g, '-');
const ISSUE_ID = `economist:${ISSUE_VERSION}`;
const ISSUE_ARTICLES_DIR = path.join(ROOT, 'data', 'magazines', 'articles', `economist_${ISSUE_VERSION}`);
const ID_VERSION = ISSUE_VERSION.replace(/^ai-rewrites-/, '') || 'v1';
const DATE = process.env.ECONOMIST_REWRITE_DATE || new Date().toISOString().slice(0, 10).replaceAll('-', '.');
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.ECONOMIST_REWRITE_DRY_RUN || '');
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = Math.max(60_000, Number(process.env.ECONOMIST_REWRITE_TIMEOUT_MS || 12 * 60_000));

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, `${line}\n`);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

function loadSources() {
  if (!fs.existsSync(ARTICLES_DIR)) throw new Error(`Missing article directory: ${ARTICLES_DIR}`);
  const articles = [];
  for (const name of fs.readdirSync(ARTICLES_DIR).filter((entry) => entry.endsWith('.json'))) {
    try {
      articles.push(JSON.parse(fs.readFileSync(path.join(ARTICLES_DIR, name), 'utf8')));
    } catch (error) {
      log('skip malformed source', name, error instanceof Error ? error.message : String(error));
    }
  }
  return articles;
}

function sourceParagraphs(article) {
  return (article.content || [])
    .filter((paragraph) => typeof paragraph === 'string' && paragraph.trim())
    .slice(0, 24)
    .map((paragraph) => paragraph.trim())
    .join(' ')
    .slice(0, 18_000);
}

function readProgress() {
  const value = readJson(PROGRESS_FILE, {});
  return value && typeof value === 'object' ? value : {};
}

function writeProgress(progress) {
  writeJson(PROGRESS_FILE, { ...progress, updatedAt: new Date().toISOString() });
}

function resultIsUsable(result) {
  return Boolean(
    result && typeof result.title === 'string' && result.title.trim()
      && typeof result.description === 'string' && result.description.trim()
      && Array.isArray(result.paragraphs) && result.paragraphs.length >= 2
      && result.paragraphs.every((paragraph) => typeof paragraph === 'string' && paragraph.trim())
  );
}

function articleIsUsable(article) {
  return Boolean(
    article && typeof article.id === 'string' && article.id.trim()
      && typeof article.title === 'string' && article.title.trim()
      && Array.isArray(article.content) && article.content.length >= 2
      && article.content.every((paragraph) => typeof paragraph === 'string' && paragraph.trim())
      && (article.level === 'A1' || article.level === 'A2')
  );
}

async function postTutor(body) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${BASE}/api/tutor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Economist-Rewrite': '1' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`non-json response ${response.status}: ${text.slice(0, 200)}`);
      }
      if (!response.ok || payload.ok === false) {
        throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      }
      return payload.result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const retryable = lastError.name === 'AbortError'
        || /429|5\d\d|rate|timeout|abort|fetch|concurr|failed/i.test(lastError.message);
      if (!retryable || attempt >= MAX_RETRIES) throw lastError;
      const waitMs = Math.min(30_000, 1500 * 2 ** attempt + Math.random() * 500);
      log(`retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(waitMs)}ms`, lastError.message);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('rewrite request failed');
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, run));
  return results;
}

function saveGeneratedArticle(article) {
  const filename = `${article.id.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.json`;
  writeJson(path.join(ROOT, 'data', 'magazines', 'articles_by_id', filename), article);
  writeJson(path.join(ISSUE_ARTICLES_DIR, filename), article);
}

function updateCatalog(articles) {
  const issuePayload = buildRewriteIssue({ issueId: ISSUE_ID, date: DATE, articles });
  writeJson(path.join(ISSUES_DIR, `economist_${ISSUE_VERSION}.json`), issuePayload.issue);
  for (const article of articles) {
    const filename = `${article.id.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.json`;
    writeJson(path.join(ISSUE_ARTICLES_DIR, filename), article);
  }
  const index = readJson(INDEX_FILE, { lastSyncAt: null, sources: [], issues: [] });
  index.issues = Array.isArray(index.issues) ? index.issues.filter((issue) => issue.id !== ISSUE_ID) : [];
  index.issues.push(issuePayload.issue);
  index.sources = Array.isArray(index.sources) ? index.sources : [];
  const economist = index.sources.find((source) => source.id === 'economist');
  if (economist) economist.issueCount = index.issues.filter((issue) => issue.sourceId === 'economist' && issue.status === 'ready').length;
  writeJson(INDEX_FILE, index);
}

async function main() {
  const sources = selectEconomistSources(loadSources(), A1_COUNT + A2_COUNT);
  const jobs = buildRewriteJobs(sources, { a1Count: A1_COUNT, a2Count: A2_COUNT });
  if (jobs.length !== A1_COUNT + A2_COUNT) {
    throw new Error(`Need ${A1_COUNT + A2_COUNT} Economist source articles, found ${jobs.length}.`);
  }
  const counts = jobs.reduce((acc, job) => ({ ...acc, [job.level]: (acc[job.level] || 0) + 1 }), {});
  log(`sources=${sources.length} jobs=${jobs.length} A1=${counts.A1 || 0} A2=${counts.A2 || 0} dryRun=${DRY_RUN}`);
  if (DRY_RUN) {
    console.log(JSON.stringify({ issueId: ISSUE_ID, date: DATE, counts, jobs: jobs.map((job) => ({ id: job.source.id, title: job.source.title, level: job.level })) }, null, 2));
    return;
  }

  const progress = readProgress();
  const completed = new Map(Object.entries(progress.completed || {}));
  for (const job of jobs) {
    const id = makeRewriteArticleId(job.source.id, job.level, ID_VERSION);
    const existing = readJson(path.join(ROOT, 'data', 'magazines', 'articles_by_id', `${id.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.json`), null);
    if (existing && articleIsUsable(existing)) {
      completed.set(id, { status: 'ready', sourceId: job.source.id, level: job.level });
    }
  }
  writeProgress({ issueId: ISSUE_ID, target: { A1: A1_COUNT, A2: A2_COUNT }, completed: Object.fromEntries(completed) });

  const pending = jobs.filter((job) => {
    const prior = completed.get(makeRewriteArticleId(job.source.id, job.level, ID_VERSION));
    return prior?.status !== 'ready';
  });
  log(`alreadyGenerated=${jobs.length - pending.length} pending=${pending.length} concurrency=${CONCURRENCY}`);
  await mapPool(pending, CONCURRENCY, async (job) => {
    const sourceText = sourceParagraphs(job.source);
    try {
      const result = await postTutor({
        intent: 'rewrite_article',
        level: job.level,
        topic: job.source.title,
        paragraphs: [sourceText],
      });
      if (!resultIsUsable(result)) throw new Error('invalid rewrite result');
      const article = buildGeneratedArticle({
        source: job.source,
        level: job.level,
        issueId: ISSUE_ID,
        date: DATE,
        generated: result,
        model: process.env.DEEPSEEK_TRANSLATE_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        issueVersion: ID_VERSION,
      });
      saveGeneratedArticle(article);
      completed.set(article.id, { status: 'ready', sourceId: job.source.id, level: job.level });
      writeProgress({ issueId: ISSUE_ID, target: { A1: A1_COUNT, A2: A2_COUNT }, completed: Object.fromEntries(completed) });
      log('done', job.level, job.source.id, '->', article.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      completed.set(makeRewriteArticleId(job.source.id, job.level, ID_VERSION), { status: 'failed', sourceId: job.source.id, level: job.level, error: message });
      writeProgress({ issueId: ISSUE_ID, target: { A1: A1_COUNT, A2: A2_COUNT }, completed: Object.fromEntries(completed) });
      log('failed', job.level, job.source.id, message);
    }
  });

  const finalArticles = jobs
    .map((job) => readJson(path.join(ROOT, 'data', 'magazines', 'articles_by_id', `${makeRewriteArticleId(job.source.id, job.level, ID_VERSION).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.json`), null))
    .filter(articleIsUsable);
  updateCatalog(finalArticles);
  const finalCounts = finalArticles.reduce((acc, article) => ({ ...acc, [article.level]: (acc[article.level] || 0) + 1 }), {});
  log(`complete generated=${finalArticles.length} A1=${finalCounts.A1 || 0} A2=${finalCounts.A2 || 0} failed=${jobs.length - finalArticles.length}`);
  if (finalArticles.length !== jobs.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
