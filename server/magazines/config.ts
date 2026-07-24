import type { MagazineSourceMeta } from '../../src/types';

export const GITHUB_REPO_OWNER = 'hehonghui';
export const GITHUB_REPO_NAME = 'awesome-english-ebooks';
export const GITHUB_REPO_REF = process.env.MAGAZINE_REPO_REF || 'master';
export const GITHUB_API_BASE = 'https://api.github.com';
export const USER_AGENT = 'english-ai-active-reading-app';

export const MAGAZINE_SOURCES: MagazineSourceMeta[] = [
  {
    id: 'economist',
    repoDir: '01_economist',
    displayName: 'The Economist',
    levelHint: 'C1',
    topic: 'Current Affairs',
  },
  {
    id: 'new_yorker',
    repoDir: '02_new_yorker',
    displayName: 'The New Yorker',
    levelHint: 'C1',
    topic: 'Culture & Literature',
  },
  {
    id: 'atlantic',
    repoDir: '04_atlantic',
    displayName: 'The Atlantic',
    levelHint: 'C1',
    topic: 'Ideas & Society',
  },
  {
    id: 'wired',
    repoDir: '05_wired',
    displayName: 'Wired',
    levelHint: 'B2',
    topic: 'Technology',
  },
];

export function getMaxIssuesPerSource(override?: number): number {
  if (typeof override === 'number' && override > 0) return Math.min(override, 30);
  const fromEnv = Number(process.env.MAGAZINE_MAX_ISSUES_PER_SOURCE || 4);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? Math.min(fromEnv, 30) : 4;
}

export function getSyncCronExpression(): string {
  return process.env.MAGAZINE_SYNC_CRON || '0 12 * * 5';
}

/** Default true: pull all configured magazine sources on server start. Set MAGAZINE_SYNC_ON_BOOT=false to disable. */
export function shouldSyncOnBoot(): boolean {
  const raw = (process.env.MAGAZINE_SYNC_ON_BOOT ?? 'true').toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

export function getSourceById(id: string): MagazineSourceMeta | undefined {
  return MAGAZINE_SOURCES.find((s) => s.id === id);
}

/** Parse issue folder names like te_2026.07.18, tny_2026.07.14, or plain 2026.07.18 */
export function parseIssueLabel(dirName: string): string {
  const dateMatch = dirName.match(/(\d{4}[._\-]\d{2}[._\-]\d{2})/);
  if (dateMatch) {
    return dateMatch[1].split(/[._\-]/).join('.');
  }
  return dirName.replace(/^(te|tny|ta|wired|the)[_-]?/i, '') || dirName;
}

export function makeIssueId(sourceId: string, issueLabel: string): string {
  return `${sourceId}:${issueLabel}`;
}

export function issueFileKey(sourceId: string, issueLabel: string): string {
  return `${sourceId}_${issueLabel.replace(/[.:]/g, '-')}`;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'article'
  );
}

export function makeArticleId(sourceId: string, issueLabel: string, title: string, index: number): string {
  return `mag:${sourceId}:${issueLabel}:${slugify(title) || 'part'}-${index + 1}`;
}
