import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import type { CanonicalEvidence, Verdict } from '../artifacts/evidence.js';
import type { SessionMetadata } from './metadata.js';

const MANIFEST_FILENAME = 'artifact-manifest.json';

export type GitProvenance = {
  repository: string;
  branch: string;
  commitSha: string;
  treeHash: string;
  sourceDirty: boolean;
};

export type ManifestArtifactKind =
  | 'screenshot'
  | 'video'
  | 'viewer'
  | 'summary'
  | 'evidence'
  | 'verdict'
  | 'log';

export type ManifestArtifact = {
  id: string;
  kind: ManifestArtifactKind;
  path: string;
  sha256: string;
  size: number;
  order: number;
};

export type ArtifactManifest = {
  version: 1;
  sessionId: string;
  repository: string;
  branch: string;
  commitSha: string;
  treeHash: string;
  sourceDirty: boolean;
  sourceDrift: boolean;
  startedAt: string;
  finalizedAt: string;
  completion: 'complete';
  verdict: Verdict['status'];
  artifacts: ManifestArtifact[];
};

export function captureGitProvenance(
  cwd: string = process.cwd(),
  excludedPaths: string[] = [],
): GitProvenance {
  const git = (args: string[]): string =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    const repository = normalizeRepository(git(['remote', 'get-url', 'origin']));
    const branch = git(['branch', '--show-current']);
    const commitSha = git(['rev-parse', 'HEAD']);
    const treeHash = git(['rev-parse', 'HEAD^{tree}']);
    const exclusions = excludedPaths
      .map((excludedPath) => path.relative(cwd, path.resolve(excludedPath)))
      .filter((relativePath) => relativePath && !relativePath.startsWith('..'))
      .map(
        (relativePath) =>
          `:(exclude)${relativePath.split(path.sep).join(path.posix.sep)}`,
      );
    const sourceDirty =
      git([
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        '.',
        ...exclusions,
      ]) !== '';
    return { repository, branch, commitSha, treeHash, sourceDirty };
  } catch {
    return {
      repository: '',
      branch: '',
      commitSha: '',
      treeHash: '',
      sourceDirty: true,
    };
  }
}

export function normalizeRepository(remote: string): string {
  const trimmed = remote.trim();
  const scpStyle = trimmed.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  if (scpStyle && !trimmed.includes('://')) {
    return `${scpStyle[1]}/${scpStyle[2]}`
      .replace(/\.git$/, '')
      .replace(/\/$/, '');
  }
  try {
    const parsed = new URL(trimmed);
    return `${parsed.hostname}${parsed.pathname}`
      .replace(/\.git$/, '')
      .replace(/\/$/, '');
  } catch {
    return trimmed
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  }
}

export function writeArtifactManifest(options: {
  sessionId: string;
  sessionDir: string;
  metadata: SessionMetadata;
  evidence: CanonicalEvidence;
  verdict: Verdict;
  finalizedProvenance?: GitProvenance;
}): ArtifactManifest {
  const finalized =
    options.finalizedProvenance ||
    captureGitProvenance(options.metadata.repositoryRoot, [
      path.dirname(options.sessionDir),
    ]);
  const sourceDrift =
    (options.metadata.repository || '') !== finalized.repository ||
    options.metadata.branch !== finalized.branch ||
    options.metadata.commitSha !== finalized.commitSha ||
    (options.metadata.treeHash || '') !== finalized.treeHash ||
    options.metadata.sourceDirty !== false ||
    finalized.sourceDirty;
  const artifacts = collectManifestArtifacts(
    options.sessionDir,
    options.evidence,
  );
  const manifest: ArtifactManifest = {
    version: 1,
    sessionId: options.sessionId,
    repository: options.metadata.repository || '',
    branch: options.metadata.branch,
    commitSha: options.metadata.commitSha,
    treeHash: options.metadata.treeHash || '',
    sourceDirty: options.metadata.sourceDirty !== false,
    sourceDrift,
    startedAt: options.metadata.startedAt,
    finalizedAt: new Date().toISOString(),
    completion: 'complete',
    verdict: options.verdict.status,
    artifacts,
  };
  writeJsonAtomically(
    path.join(options.sessionDir, MANIFEST_FILENAME),
    manifest,
  );
  return manifest;
}

export function loadArtifactManifest(
  sessionDir: string,
): ArtifactManifest | null {
  const manifestPath = path.join(sessionDir, MANIFEST_FILENAME);
  try {
    if (
      fs.lstatSync(sessionDir).isSymbolicLink() ||
      fs.lstatSync(manifestPath).isSymbolicLink()
    ) {
      return null;
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return isArtifactManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function validateManifestArtifacts(
  sessionDir: string,
  manifest: ArtifactManifest,
): void {
  const root = fs.realpathSync(sessionDir);
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const [index, artifact] of manifest.artifacts.entries()) {
    if (ids.has(artifact.id)) {
      throw new Error(`Duplicate artifact ID: ${artifact.id}`);
    }
    ids.add(artifact.id);
    if (paths.has(artifact.path)) {
      throw new Error(`Duplicate artifact path: ${artifact.path}`);
    }
    paths.add(artifact.path);
    if (artifact.order !== index) {
      throw new Error(`Artifact order is invalid for ${artifact.id}.`);
    }
    if (
      !artifact.path ||
      path.isAbsolute(artifact.path) ||
      artifact.path.split(/[\\/]/).includes('..')
    ) {
      throw new Error(`Unsafe artifact path: ${artifact.path}`);
    }
    if (
      (artifact.kind === 'screenshot' || artifact.kind === 'video') &&
      path.dirname(artifact.path) !== '.'
    ) {
      throw new Error(
        `Publishable media must be stored at the session root: ${artifact.path}`,
      );
    }
    const artifactPath = path.resolve(sessionDir, artifact.path);
    let componentPath = sessionDir;
    for (const component of artifact.path.split(/[\\/]/)) {
      componentPath = path.join(componentPath, component);
      if (fs.lstatSync(componentPath).isSymbolicLink()) {
        throw new Error(`Artifact path contains a symlink: ${artifact.path}`);
      }
    }
    const stat = fs.lstatSync(artifactPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Artifact is not a regular file: ${artifact.path}`);
    }
    const realPath = fs.realpathSync(artifactPath);
    if (!realPath.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Artifact escapes its session directory: ${artifact.path}`);
    }
    const contents = fs.readFileSync(realPath);
    const hash = createHash('sha256').update(contents).digest('hex');
    if (hash !== artifact.sha256 || contents.length !== artifact.size) {
      throw new Error(`Artifact hash mismatch: ${artifact.path}`);
    }
  }
}

function isArtifactManifest(value: unknown): value is ArtifactManifest {
  if (typeof value !== 'object' || value === null) return false;
  const manifest = value as Partial<ArtifactManifest>;
  return (
    manifest.version === 1 &&
    typeof manifest.sessionId === 'string' &&
    typeof manifest.repository === 'string' &&
    typeof manifest.branch === 'string' &&
    typeof manifest.commitSha === 'string' &&
    typeof manifest.treeHash === 'string' &&
    typeof manifest.sourceDirty === 'boolean' &&
    typeof manifest.sourceDrift === 'boolean' &&
    typeof manifest.startedAt === 'string' &&
    typeof manifest.finalizedAt === 'string' &&
    manifest.completion === 'complete' &&
    (manifest.verdict === 'PASS' ||
      manifest.verdict === 'FAIL' ||
      manifest.verdict === 'INCOMPLETE' ||
      manifest.verdict === 'BLOCKED') &&
    Array.isArray(manifest.artifacts) &&
    manifest.artifacts.every(
      (artifact, index) =>
        typeof artifact === 'object' &&
        artifact !== null &&
        typeof artifact.id === 'string' &&
        typeof artifact.path === 'string' &&
        typeof artifact.sha256 === 'string' &&
        typeof artifact.size === 'number' &&
        artifact.size >= 0 &&
        artifact.order === index &&
        [
          'screenshot',
          'video',
          'viewer',
          'summary',
          'evidence',
          'verdict',
          'log',
        ].includes(artifact.kind),
    )
  );
}

function collectManifestArtifacts(
  sessionDir: string,
  evidence: CanonicalEvidence,
): ManifestArtifact[] {
  const screenshotOrder = new Map(
    evidence.actions
      .map((action) => action.action.match(/^screenshot\s+(.+)$/)?.[1])
      .filter((value): value is string => Boolean(value))
      .map((value, index) => [path.basename(value), index]),
  );
  const verifiedScreenshots = new Set(
    evidence.screenshots
      .filter(
        (screenshot) =>
          screenshot.validPng &&
          !screenshot.visuallyBlank &&
          screenshot.sha256 !== null,
      )
      .map((screenshot) => screenshot.file),
  );
  const candidates = listArtifactFiles(sessionDir)
    .filter((file) => {
      const kind = classifyArtifact(file);
      return (
        kind !== null &&
        (kind !== 'screenshot' || verifiedScreenshots.has(path.basename(file)))
      );
    })
    .sort((left, right) => {
      const leftOrder = screenshotOrder.get(path.basename(left));
      const rightOrder = screenshotOrder.get(path.basename(right));
      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) -
          (rightOrder ?? Number.MAX_SAFE_INTEGER);
      }
      return left.localeCompare(right);
    });
  return candidates.map((file, order) => {
    const contents = fs.readFileSync(path.join(sessionDir, file));
    const kind = classifyArtifact(file)!;
    return {
      id: `${kind}:${file}`,
      kind,
      path: file,
      sha256: createHash('sha256').update(contents).digest('hex'),
      size: contents.length,
      order,
    };
  });
}

function listArtifactFiles(
  root: string,
  current: string = root,
): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...listArtifactFiles(root, absolutePath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolutePath));
    }
  }
  return files;
}

function classifyArtifact(file: string): ManifestArtifactKind | null {
  const basename = path.basename(file);
  const isSessionRoot = path.dirname(file) === '.';
  if (isSessionRoot && file.endsWith('.png')) return 'screenshot';
  if (
    isSessionRoot &&
    (basename === 'session.webm' || basename === 'session.mp4')
  ) {
    return 'video';
  }
  if (isSessionRoot && basename === 'viewer.html') return 'viewer';
  if (isSessionRoot && basename === 'SUMMARY.md') return 'summary';
  if (isSessionRoot && basename === 'evidence.json') return 'evidence';
  if (isSessionRoot && basename === 'verdict.json') return 'verdict';
  if (file.endsWith('.log') || file.endsWith('.ndjson')) return 'log';
  return null;
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}
