import {
  GITHUB_API_BASE,
  GITHUB_REPO_NAME,
  GITHUB_REPO_OWNER,
  GITHUB_REPO_REF,
  USER_AGENT,
  parseIssueLabel,
} from './config';

export interface GitHubContentItem {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir' | string;
  download_url: string | null;
}

export interface RemoteIssueCandidate {
  dirName: string;
  issueLabel: string;
  path: string;
  preferredFile: GitHubContentItem;
  format: 'epub' | 'pdf';
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function listRepoContents(dirPath = ''): Promise<GitHubContentItem[]> {
  const url = `${GITHUB_API_BASE}/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${dirPath}?ref=${GITHUB_REPO_REF}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 403 || res.status === 429) {
    const err = new Error(`GitHub rate limit or forbidden (${res.status})`);
    (err as Error & { code?: string }).code = 'GITHUB_RATE_LIMIT';
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`GitHub API ${res.status}: ${await res.text()}`);
    (err as Error & { code?: string }).code = 'GITHUB_API_ERROR';
    throw err;
  }
  const data = (await res.json()) as GitHubContentItem[] | GitHubContentItem;
  return Array.isArray(data) ? data : [data];
}

export async function downloadFile(downloadUrl: string): Promise<Buffer> {
  const res = await fetch(downloadUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to download ${downloadUrl}: ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function pickPreferredFile(files: GitHubContentItem[]): { file: GitHubContentItem; format: 'epub' | 'pdf' } | null {
  const epub = files.find((f) => f.type === 'file' && f.name.toLowerCase().endsWith('.epub'));
  if (epub) return { file: epub, format: 'epub' };
  const pdf = files.find((f) => f.type === 'file' && f.name.toLowerCase().endsWith('.pdf'));
  if (pdf) return { file: pdf, format: 'pdf' };
  return null;
}

/** List issue folders under a magazine source directory, newest first. */
export async function discoverIssues(repoDir: string, maxIssues: number): Promise<RemoteIssueCandidate[]> {
  const entries = await listRepoContents(repoDir);
  const dirs = entries
    .filter((e) => e.type === 'dir' && !['fonts', 'images', 'assets'].includes(e.name.toLowerCase()))
    .sort((a, b) => (a.name < b.name ? 1 : -1));

  const candidates: RemoteIssueCandidate[] = [];
  for (const dir of dirs.slice(0, maxIssues)) {
    try {
      const files = await listRepoContents(dir.path);
      const preferred = pickPreferredFile(files);
      if (!preferred || !preferred.file.download_url) continue;
      candidates.push({
        dirName: dir.name,
        issueLabel: parseIssueLabel(dir.name),
        path: dir.path,
        preferredFile: preferred.file,
        format: preferred.format,
      });
    } catch (err) {
      console.warn(`[magazines] skip issue dir ${dir.path}:`, err);
    }
  }
  return candidates;
}
