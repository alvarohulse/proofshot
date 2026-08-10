import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import {
  type GitHubUploadProvider,
  getGitHubToken,
  getRepoInfo,
  getPRNumber,
  getPRHeadProvenance,
  uploadAssets,
  postPRComment,
} from '../utils/github.js';
import { loadMetadata } from '../session/metadata.js';
import { formatPRComment, type PRCommentData } from '../artifacts/pr-format.js';
import {
  captureGitProvenance,
  type ArtifactManifest,
  type ManifestArtifact,
} from '../session/manifest.js';
import {
  selectPublication,
  type PublicationSelection,
} from '../session/publication.js';

interface PROptions {
  prNumber?: string;
  dryRun?: boolean;
  uploadProvider?: GitHubUploadProvider;
  artifactsBranch?: string;
  session?: string;
  screenshot?: string[];
  legacySession?: boolean;
}

export async function prCommand(options: PROptions): Promise<void> {
  const config = loadConfig();
  const outputDir = path.resolve(config.output);
  const uploadProvider = normalizeUploadProvider(options.uploadProvider);
  const artifactsBranch = options.artifactsBranch || 'proofshot-artifacts';
  const local = captureGitProvenance();
  if (!local.repository || !local.branch || !local.commitSha) {
    throw new Error(
      'ProofShot could not determine the current repository, branch, and commit.',
    );
  }
  const prNumber = options.dryRun
    ? null
    : getPRNumber(options.prNumber);
  const target = prNumber
    ? getPRHeadProvenance(prNumber)
    : {
        repository: local.repository,
        branch: local.branch,
        headSha: local.commitSha,
      };
  console.log(
    chalk.dim(
      `Target: ${target.repository} ${target.branch}@${target.headSha.slice(0, 7)}`,
    ),
  );

  let selection: PublicationSelection;
  try {
    selection = selectPublication({
      outputDir,
      sessionId: options.session,
      screenshotIds: options.screenshot,
      ...target,
    });
  } catch (error) {
    if (!options.legacySession) {
      throw error;
    }
    selection = selectLegacyPublication({
      outputDir,
      sessionId: options.session,
      screenshotIds: options.screenshot,
      ...target,
    });
    console.log(
      chalk.yellow(
        '⚠ Publishing an explicitly selected legacy session without a finalized provenance manifest.',
      ),
    );
  }

  const metadata = loadMetadata(selection.sessionDir);
  const description = metadata?.description || null;
  const screenshotPaths = selection.screenshots.map((artifact) =>
    path.join(selection.sessionDir, artifact.path),
  );
  const videoPath = selection.video
    ? path.join(selection.sessionDir, selection.video.path)
    : null;
  const errorCount = readIncidentCount(selection.sessionDir);
  const filesToUpload = [
    ...screenshotPaths,
    ...(videoPath ? [videoPath] : []),
  ];
  if (filesToUpload.length === 0) {
    throw new Error('The selected session has no publishable screenshots or video.');
  }

  // For --dry-run, generate markdown with placeholder URLs (no GitHub dependency).
  if (options.dryRun) {
    const screenshotMap = new Map<string, string>();
    for (const ssPath of screenshotPaths) {
      const label = path.basename(ssPath);
      screenshotMap.set(label, `https://github.com/user-attachments/assets/<${label}>`);
    }

    const commentData: PRCommentData = {
      description,
      sessionCount: 1,
      screenshots: screenshotMap,
      video: videoPath
        ? {
            url: `https://github.com/user-attachments/assets/<${path.basename(videoPath)}>`,
            renderMode: 'embed',
          }
        : null,
      errorCount,
      branch: selection.manifest.branch,
      commitSha: selection.manifest.commitSha,
    };

    console.log('');
    console.log(chalk.yellow('--- Dry run (not posted) ---'));
    console.log(formatPRComment(commentData));
    return;
  }

  if (prNumber === null) {
    throw new Error('A target PR is required for publication.');
  }
  console.log(chalk.dim(`Target PR: #${prNumber}`));

  const token = getGitHubToken();
  const repoInfo = await getRepoInfo(token);

  const uploadRoot = buildUploadRoot(
    prNumber,
    selection.manifest,
  );

  console.log(chalk.dim(`Upload provider: ${uploadProvider}`));
  if (uploadProvider === 'repo-contents') {
    console.log(chalk.dim(`Artifacts branch: ${artifactsBranch}`));
  }
  console.log(chalk.dim(`Uploading ${filesToUpload.length} artifact(s)...`));

  const uploaded = await uploadAssets({
    filePaths: filesToUpload,
    token,
    repo: repoInfo,
    uploadProvider,
    uploadRoot,
    artifactsBranch,
    onProgress: (current, total, fileName) => {
      console.log(chalk.dim(`  [${current}/${total}] ${fileName}`));
    },
  });

  if (uploaded.size !== filesToUpload.length) {
    throw new Error(
      `Only ${uploaded.size}/${filesToUpload.length} artifacts uploaded. PR comment was not posted.`,
    );
  }

  const screenshotMap = new Map<string, string>();
  for (const ssPath of screenshotPaths) {
    const asset = uploaded.get(ssPath);
    if (!asset) throw new Error(`Missing uploaded screenshot: ${ssPath}`);
    screenshotMap.set(path.basename(ssPath), asset.url);
  }

  // Get video URL
  let video: { url: string; renderMode: 'embed' | 'link' } | null = null;
  if (videoPath) {
    const videoAsset = uploaded.get(videoPath);
    if (!videoAsset) throw new Error(`Missing uploaded video: ${videoPath}`);
    video = {
      url: videoAsset.url,
      renderMode: uploadProvider === 'repo-contents' ? 'link' : 'embed',
    };
  }

  const commentData: PRCommentData = {
    description,
    sessionCount: 1,
    screenshots: screenshotMap,
    video,
    errorCount,
    branch: selection.manifest.branch,
    commitSha: selection.manifest.commitSha,
  };

  const commentBody = formatPRComment(commentData);

  console.log(chalk.dim('Posting PR comment...'));
  postPRComment(prNumber, commentBody);

  console.log('');
  console.log(chalk.green.bold(`✅ Posted ProofShot verification to PR #${prNumber}`));
  console.log(
    chalk.dim(`  ${screenshotMap.size} screenshot(s), ${video ? '1 video' : 'no video'}`),
  );
}

function buildUploadRoot(
  prNumber: number,
  manifest: ArtifactManifest,
): string {
  const sessionId =
    manifest.sessionId
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'session';
  const manifestHash = createHash('sha256')
    .update(JSON.stringify(manifest))
    .digest('hex')
    .slice(0, 12);
  return path.posix.join(
    'proofshot',
    `pr-${prNumber}`,
    sessionId,
    manifestHash,
  );
}

function readIncidentCount(sessionDir: string): number {
  try {
    const evidence = JSON.parse(
      fs.readFileSync(path.join(sessionDir, 'evidence.json'), 'utf-8'),
    ) as { incidents?: Array<{ count?: number }> };
    return (evidence.incidents || []).reduce(
      (total, incident) => total + (incident.count || 0),
      0,
    );
  } catch {
    return 0;
  }
}

function selectLegacyPublication(options: {
  outputDir: string;
  sessionId?: string;
  screenshotIds?: string[];
  repository: string;
  branch: string;
  headSha: string;
}): PublicationSelection {
  if (
    !options.sessionId ||
    path.basename(options.sessionId) !== options.sessionId
  ) {
    throw new Error(
      'Legacy publication requires an exact --session folder name.',
    );
  }
  const sessionDir = path.join(options.outputDir, options.sessionId);
  const stat = fs.lstatSync(sessionDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Legacy session is not a safe directory.');
  }
  if (fs.existsSync(path.join(sessionDir, 'artifact-manifest.json'))) {
    throw new Error(
      'A finalized manifest exists; --legacy-session cannot bypass its validation.',
    );
  }
  const metadata = loadMetadata(sessionDir);
  if (
    !metadata ||
    metadata.branch !== options.branch ||
    metadata.commitSha !== options.headSha
  ) {
    throw new Error(
      'Legacy session branch and commit must match the target PR head.',
    );
  }
  const artifacts = fs
    .readdirSync(sessionDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        (entry.name.endsWith('.png') ||
          entry.name === 'session.webm' ||
          entry.name === 'session.mp4'),
    )
    .map((entry, order): ManifestArtifact => {
      const contents = fs.readFileSync(path.join(sessionDir, entry.name));
      return {
        id: `${entry.name.endsWith('.png') ? 'screenshot' : 'video'}:${entry.name}`,
        kind: entry.name.endsWith('.png') ? 'screenshot' : 'video',
        path: entry.name,
        sha256: createHash('sha256').update(contents).digest('hex'),
        size: contents.length,
        order,
      };
    });
  const screenshots = artifacts.filter(
    (artifact) => artifact.kind === 'screenshot',
  );
  const requestedScreenshots = options.screenshotIds?.length
    ? options.screenshotIds.map((selector) => {
        const matches = screenshots.filter(
          (artifact) =>
            artifact.id === selector ||
            artifact.path === selector ||
            path.basename(artifact.path) === selector,
        );
        if (matches.length !== 1) {
          throw new Error(`Legacy screenshot selection failed: ${selector}`);
        }
        return matches[0];
      })
    : screenshots;
  const videos = artifacts.filter((artifact) => artifact.kind === 'video');
  if (videos.length > 1) {
    throw new Error('Legacy session contains multiple videos.');
  }
  const manifest: ArtifactManifest = {
    version: 1,
    sessionId: options.sessionId,
    repository: options.repository,
    branch: metadata.branch,
    commitSha: metadata.commitSha,
    treeHash: metadata.treeHash || '',
    sourceDirty: true,
    sourceDrift: true,
    startedAt: metadata.startedAt,
    finalizedAt: metadata.startedAt,
    completion: 'complete',
    verdict: 'BLOCKED',
    artifacts,
  };
  return {
    sessionDir,
    manifest,
    screenshots: requestedScreenshots,
    video: videos[0] || null,
  };
}

function normalizeUploadProvider(provider?: string): GitHubUploadProvider {
  if (!provider || provider === 'repo-contents' || provider === 'github-web-attachments') {
    return provider || 'repo-contents';
  }

  console.error(
    chalk.red('✗') +
      ` Invalid upload provider "${provider}". Use "repo-contents" or "github-web-attachments".`,
  );
  process.exit(1);
}
