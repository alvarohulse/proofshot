import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, execSync } from 'child_process';
import { ProofShotError } from './exec.js';

// ─── Types ───

export interface GitHubRepo {
  owner: string;
  repo: string;
  id: number;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface UploadedAsset {
  url: string;
  name: string;
}

export interface UploadedVideoAsset extends UploadedAsset {
  renderMode: 'embed' | 'link';
}

export type GitHubUploadProvider = 'repo-contents' | 'github-web-attachments';

export interface PreparedUploadAsset {
  key: string;
  name: string;
  relativeDirectory: string;
  content: Buffer;
}

export interface UploadAssetsOptions {
  filePaths?: string[];
  preparedAssets?: PreparedUploadAsset[];
  token: string;
  repo: GitHubRepo;
  uploadProvider: GitHubUploadProvider;
  uploadRoot: string;
  artifactsBranch?: string;
  onProgress?: (current: number, total: number, fileName: string) => void;
}

const GITHUB_API_VERSION = '2022-11-28';
const DEFAULT_ARTIFACTS_BRANCH = 'proofshot-artifacts';

class GitHubApiError extends ProofShotError {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`GitHub API request failed (${status}): ${body}`);
    this.name = 'GitHubApiError';
  }
}

// ─── Authentication ───

/**
 * Get GitHub auth token via gh CLI.
 */
export function getGitHubToken(): string {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken) return envToken.trim();

  try {
    return execSync('gh auth token', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new ProofShotError(
      'GitHub CLI (gh) is not installed or not authenticated.\n' +
        'Install: https://cli.github.com\n' +
        'Then run: gh auth login',
      error,
    );
  }
}

// ─── Repository Info ───

/**
 * Get the current repo's owner, name, and numeric ID.
 */
export async function getRepoInfo(
  token: string,
  repository?: string,
): Promise<GitHubRepo> {
  let nwo: string;
  if (repository) {
    nwo = repository
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/^github\.com\//, '')
      .replace(/\.git$/, '');
  } else {
    try {
      nwo = execSync('gh repo view --json nameWithOwner -q .nameWithOwner', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch (error) {
      throw new ProofShotError(
        'Could not determine GitHub repository. Are you in a git repo with a GitHub remote?',
        error,
      );
    }
  }

  const [owner, repo] = nwo.split('/');
  if (!owner || !repo || nwo.split('/').length !== 2) {
    throw new ProofShotError(
      `Could not parse GitHub repository: ${repository || nwo}`,
    );
  }

  const repoResponse = await githubApi<{
    id: number;
    default_branch: string;
    private: boolean;
  }>(`repos/${owner}/${repo}`, token);

  return {
    owner,
    repo,
    id: repoResponse.id,
    defaultBranch: repoResponse.default_branch,
    isPrivate: repoResponse.private,
  };
}

// ─── PR Detection ───

/**
 * Find the PR number for the current branch, or validate an explicit PR number.
 */
export function getPRNumber(explicitPR?: string): number {
  if (explicitPR) {
    if (!/^\d+$/.test(explicitPR)) {
      throw new ProofShotError(`Invalid PR number: ${explicitPR}`);
    }
    const num = parseInt(explicitPR, 10);
    try {
      execSync(`gh pr view ${num} --json number -q .number`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      throw new ProofShotError(`PR #${num} not found or not accessible.`);
    }
    return num;
  }

  try {
    const numStr = execSync('gh pr view --json number -q .number', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return parseInt(numStr, 10);
  } catch {
    throw new ProofShotError(
      'No PR found for the current branch.\n' +
        'Either specify a PR number: proofshot pr 42\n' +
        'Or create a PR first: gh pr create',
    );
  }
}

export function getPRHeadProvenance(prNumber: number): {
  repository: string;
  branch: string;
  headSha: string;
} {
  try {
    const raw = execFileSync(
      'gh',
      [
        'pr',
        'view',
        String(prNumber),
        '--json',
        'headRefOid,headRefName,headRepository',
      ],
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const parsed = JSON.parse(raw) as {
      headRefOid: string;
      headRefName: string;
      headRepository: { nameWithOwner: string };
    };
    return {
      repository: `github.com/${parsed.headRepository.nameWithOwner}`,
      branch: parsed.headRefName,
      headSha: parsed.headRefOid,
    };
  } catch (error) {
    throw new ProofShotError(
      `Could not resolve the head provenance for PR #${prNumber}.`,
      error,
    );
  }
}

// ─── File Upload (GitHub User Attachments) ───

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.webm':
      return 'video/webm';
    case '.mp4':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Upload a single file to GitHub's user-attachments endpoint.
 *
 * This is the same mechanism the GitHub web UI uses for drag-and-drop uploads.
 * Flow:
 * 1. POST to /upload/policies/assets with file metadata → get S3 upload form
 * 2. POST file to S3 using the returned form fields
 * 3. Return the permanent github.com/user-attachments/assets/UUID URL
 */
export async function uploadAsset(
  filePath: string,
  token: string,
  repoId: number,
): Promise<UploadedAsset> {
  const fileName = path.basename(filePath);
  return uploadPreparedAsset(
    {
      key: filePath,
      name: fileName,
      relativeDirectory: path.basename(path.dirname(filePath)),
      content: fs.readFileSync(filePath),
    },
    token,
    repoId,
  );
}

async function uploadPreparedAsset(
  assetToUpload: PreparedUploadAsset,
  token: string,
  repoId: number,
): Promise<UploadedAsset> {
  const fileName = assetToUpload.name;
  const fileSize = assetToUpload.content.length;
  const contentType = getContentType(fileName);
  // Step 1: Request upload policy
  const policyResponse = await fetch('https://github.com/upload/policies/assets', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `token ${token}`,
    },
    body: JSON.stringify({
      name: fileName,
      size: fileSize,
      content_type: contentType,
      repository_id: repoId,
    }),
  });

  if (!policyResponse.ok) {
    const body = await policyResponse.text();
    if ([401, 403, 422].includes(policyResponse.status)) {
      throw new ProofShotError(
        `GitHub web attachment upload failed (${policyResponse.status}).\n` +
          'ProofShot\'s "github-web-attachments" provider uses GitHub\'s internal ' +
          '/upload/policies/assets endpoint, which may reject browser-based gh OAuth auth.\n' +
          'Try one of:\n' +
          '  - proofshot pr --upload-provider repo-contents\n' +
          '  - export GH_TOKEN=<token> and retry\n' +
          '  - proofshot pr --dry-run\n' +
          `GitHub response: ${body}`,
      );
    }

    throw new ProofShotError(
      `GitHub upload policy request failed (${policyResponse.status}): ${body}`,
    );
  }

  const policy = (await policyResponse.json()) as {
    upload_url: string;
    form: Record<string, string>;
    asset: { id: number; href: string };
  };

  // Step 2: Upload file to S3 using the form fields
  const formData = new FormData();

  for (const [key, value] of Object.entries(policy.form)) {
    formData.append(key, value);
  }

  // File must be the last field
  const blob = new Blob([assetToUpload.content], { type: contentType });
  formData.append('file', blob, fileName);

  const uploadResponse = await fetch(policy.upload_url, {
    method: 'POST',
    body: formData,
  });

  if (!uploadResponse.ok && uploadResponse.status !== 204 && uploadResponse.status !== 201) {
    throw new ProofShotError(
      `File upload failed (${uploadResponse.status}): ${await uploadResponse.text()}`,
    );
  }

  return {
    url: policy.asset.href,
    name: fileName,
  };
}

/**
 * Upload multiple files sequentially with progress reporting.
 * Continues past individual failures. Map is keyed by full file path
 * to avoid collisions when files from different sessions share a basename.
 */
export async function uploadAssets(
  options: UploadAssetsOptions,
): Promise<Map<string, UploadedAsset>> {
  if (options.uploadProvider === 'repo-contents') {
    return uploadAssetsToRepoContents(options);
  }

  return uploadAssetsToWebAttachments(options);
}

async function uploadAssetsToWebAttachments(
  options: UploadAssetsOptions,
): Promise<Map<string, UploadedAsset>> {
  const results = new Map<string, UploadedAsset>();
  const assets = prepareUploadAssets(options);
  const { token, repo, onProgress } = options;

  for (let i = 0; i < assets.length; i += 1) {
    const prepared = assets[i];
    onProgress?.(i + 1, assets.length, prepared.name);

    try {
      const asset = await uploadPreparedAsset(prepared, token, repo.id);
      results.set(prepared.key, asset);
    } catch (error) {
      console.error(`  Failed to upload ${prepared.name}: ${(error as Error).message}`);
    }
  }

  return results;
}

async function uploadAssetsToRepoContents(
  options: UploadAssetsOptions,
): Promise<Map<string, UploadedAsset>> {
  const results = new Map<string, UploadedAsset>();
  const artifactsBranch = options.artifactsBranch || DEFAULT_ARTIFACTS_BRANCH;
  const assets = prepareUploadAssets(options);

  await ensureArtifactsBranch(options.repo, artifactsBranch, options.token);

  for (let i = 0; i < assets.length; i += 1) {
    const prepared = assets[i];
    const fileName = prepared.name;
    options.onProgress?.(i + 1, assets.length, fileName);

    try {
      const content = prepared.content.toString('base64');
      const uploadPath = path.posix.join(
        options.uploadRoot,
        prepared.relativeDirectory,
        fileName,
      );

      let existingSha: string | undefined;
      try {
        const existing = await githubApi<{ sha: string }>(
          `repos/${options.repo.owner}/${options.repo.repo}/contents/${encodePath(uploadPath)}?ref=${encodeURIComponent(artifactsBranch)}`,
          options.token,
        );
        existingSha = existing.sha;
      } catch (error) {
        if (!(error instanceof GitHubApiError) || error.status !== 404) {
          throw error;
        }
      }
      const result = await githubApi<{ commit: { sha: string } }>(
        `repos/${options.repo.owner}/${options.repo.repo}/contents/${encodePath(uploadPath)}`,
        options.token,
        {
          method: 'PUT',
          body: JSON.stringify({
            message: `proofshot: add ${uploadPath}`,
            content,
            branch: artifactsBranch,
            ...(existingSha ? { sha: existingSha } : {}),
          }),
        },
      );

      results.set(prepared.key, {
        url: buildBlobUrl(options.repo, result.commit.sha, uploadPath),
        name: fileName,
      });
    } catch (error) {
      console.error(`  Failed to upload ${fileName}: ${(error as Error).message}`);
    }
  }

  return results;
}

function prepareUploadAssets(options: UploadAssetsOptions): PreparedUploadAsset[] {
  if (options.preparedAssets) {
    return options.preparedAssets;
  }
  return (options.filePaths || []).map((filePath) => ({
    key: filePath,
    name: path.basename(filePath),
    relativeDirectory: path.basename(path.dirname(filePath)),
    content: fs.readFileSync(filePath),
  }));
}

async function ensureArtifactsBranch(
  repo: GitHubRepo,
  branch: string,
  token: string,
): Promise<void> {
  try {
    await githubApi(
      `repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      token,
    );
    return;
  } catch (error) {
    if (!(error instanceof GitHubApiError) || error.status !== 404) throw error;
  }

  const baseRef = await githubApi<{ object: { sha: string } }>(
    `repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(repo.defaultBranch)}`,
    token,
  );

  await githubApi(`repos/${repo.owner}/${repo.repo}/git/refs`, token, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${branch}`,
      sha: baseRef.object.sha,
    }),
  });
}

function buildBlobUrl(repo: GitHubRepo, branch: string, filePath: string): string {
  const encodedBranch = encodeURIComponent(branch);
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${repo.owner}/${repo.repo}/blob/${encodedBranch}/${encodedPath}?raw=1`;
}

function encodePath(filePath: string): string {
  return filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function githubApi<T>(
  apiPath: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://api.github.com/${apiPath}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GitHubApiError(response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// ─── PR Comment ───

/**
 * Post a comment on a GitHub PR.
 * Pipes markdown body via stdin to avoid shell quoting issues.
 */
export function postPRComment(prNumber: number, body: string): void {
  try {
    execSync(`gh pr comment ${prNumber} --body-file -`, {
      input: body,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error: any) {
    const stderr = error?.stderr?.toString?.() || '';
    throw new ProofShotError(`Failed to post PR comment: ${stderr}`, error);
  }
}
