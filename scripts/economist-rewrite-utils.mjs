import crypto from 'node:crypto';

const CEFR_DIFFICULTY = { A1: 15, A2: 28 };

function dateKey(value) {
  return typeof value === 'string' ? value : '';
}

/** Return usable Economist source articles in deterministic order. */
export function selectEconomistSources(articles, limit = Infinity) {
  const seen = new Set();
  return articles
    .filter((article) => {
      if (!article || typeof article !== 'object') return false;
      if (article.magazineSourceId !== 'economist') return false;
      if (typeof article.id !== 'string' || !article.id.trim() || seen.has(article.id)) return false;
      if (article.generationKind === 'economist-cefr-rewrite' || article.id.startsWith('mag:economist:ai-rewrites-')) return false;
      if (typeof article.title !== 'string' || !article.title.trim()) return false;
      if (!Array.isArray(article.content) || article.content.filter((p) => typeof p === 'string' && p.trim()).length < 2) return false;
      seen.add(article.id);
      return true;
    })
    .sort((a, b) =>
      dateKey(b.date).localeCompare(dateKey(a.date))
      || String(a.title).localeCompare(String(b.title))
      || a.id.localeCompare(b.id)
    )
    .slice(0, Math.max(0, limit));
}

/** Assign each source to one target band, preserving the source order. */
export function buildRewriteJobs(sources, { a1Count = 50, a2Count = 50 } = {}) {
  const a1 = Math.max(0, Math.floor(Number(a1Count) || 0));
  const a2 = Math.max(0, Math.floor(Number(a2Count) || 0));
  const jobs = [];
  for (let index = 0; index < a1 + a2; index += 1) {
    const source = sources[index];
    if (!source) break;
    jobs.push({ source, level: index < a1 ? 'A1' : 'A2' });
  }
  return jobs;
}

export function makeRewriteArticleId(sourceArticleId, level, issueVersion = 'v1') {
  const normalizedLevel = String(level).trim().toUpperCase();
  const digest = crypto.createHash('sha256').update(`${sourceArticleId}\u0000${normalizedLevel}`).digest('hex').slice(0, 12);
  return `mag:economist:ai-rewrites-${issueVersion}:${normalizedLevel.toLowerCase()}-${digest}`;
}

function cleanString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** Convert a validated tutor result into an ordinary magazine article record. */
export function buildGeneratedArticle({ source, level, issueId, date, generated, model, issueVersion = 'v1' }) {
  const normalizedLevel = String(level).trim().toUpperCase();
  const title = cleanString(generated?.title, source.title);
  const description = cleanString(generated?.description, `A CEFR ${normalizedLevel} reading article.`);
  const paragraphs = Array.isArray(generated?.paragraphs)
    ? generated.paragraphs.filter((paragraph) => typeof paragraph === 'string' && paragraph.trim()).map((paragraph) => paragraph.trim())
    : [];
  const keyWords = Array.isArray(generated?.keyWords)
    ? generated.keyWords.filter((word) => typeof word === 'string' && word.trim()).map((word) => word.trim())
    : [];

  return {
    id: makeRewriteArticleId(source.id, normalizedLevel, issueVersion),
    title,
    description,
    date,
    status: 'In Progress',
    source: 'magazine',
    level: normalizedLevel,
    topic: 'The Economist',
    magazineIssueId: issueId,
    magazineSourceId: 'economist',
    content: paragraphs,
    keyWords,
    levelRating: {
      level: normalizedLevel,
      difficultyScore: CEFR_DIFFICULTY[normalizedLevel] ?? 20,
      summary: `AI-generated ${normalizedLevel} reading article based on a The Economist source.`,
    },
    importEnrichmentStatus: 'pending',
    generatedFromArticleId: source.id,
    generatedFromArticleTitle: source.title,
    generationKind: 'economist-cefr-rewrite',
    generationProvider: 'deepseek',
    generationModel: model || 'deepseek-v4-flash',
    generatedAt: new Date().toISOString(),
  };
}

export function buildRewriteIssue({ issueId, date, articles }) {
  return {
    issue: {
      id: issueId,
      sourceId: 'economist',
      issueLabel: issueId.slice(issueId.indexOf(':') + 1),
      title: `The Economist - AI CEFR rewrites (${date})`,
      publishedAt: date,
      importedAt: new Date().toISOString(),
      format: 'html',
      remotePath: 'deepseek://deepseek-v4-flash/economist-rewrite',
      articleCount: articles.length,
      status: 'ready',
    },
    articles: articles.map((article) => ({
      id: article.id,
      title: article.title,
      description: article.description,
      wordCount: article.content.join(' ').trim().split(/\s+/).filter(Boolean).length,
    })),
  };
}
