import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import {
  type GitHubUploadProvider,
  type PreparedUploadAsset,
  getGitHubToken,
  getRepoInfo,
  getPRNumber,
  getPRHeadProvenance,
  uploadAssets,
  postPRComment,
} from '../utils/github.js';
import { loadMetadata } from '../session/metadata.js';
import { sanitizeDiagnosticMessage } from '../browser/provenance.js';
import { formatPRComment, type PRCommentData } from '../artifacts/pr-format.js';
import {
  captureGitProvenance,
  type ArtifactManifest,
  type ManifestArtifact,
} from '../session/manifest.js';
import {
  matchesScreenshotSelector,
  selectPublications,
  type PublicationSelection,
} from '../session/publication.js';

interface PROptions {
  prNumber?: string;
  dryRun?: boolean;
  uploadProvider?: GitHubUploadProvider;
  artifactsBranch?: string;
  session?: string[];
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
  const prNumber = options.dryRun && !options.prNumber
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

  let selections: PublicationSelection[];
  try {
    selections = selectPublications({
      outputDir,
      sessionIds: options.session,
      screenshotIds: options.screenshot,
      ...target,
    });
  } catch (error) {
    if (!options.legacySession) {
      throw error;
    }
    if (options.session?.length !== 1) {
      throw new Error(
        'Legacy publication requires exactly one explicit --session.',
      );
    }
    selections = [
      selectLegacyPublication({
        outputDir,
        sessionId: options.session[0],
        screenshotIds: options.screenshot,
        ...target,
      }),
    ];
    console.log(
      chalk.yellow(
        '⚠ Publishing an explicitly selected legacy session without a finalized provenance manifest.',
      ),
    );
  }

  const descriptions = selections
    .map((selection) => loadMetadata(selection.sessionDir)?.description)
    .filter(
      (description): description is string =>
        typeof description === 'string' && description.length > 0,
    );
  const description = descriptions.length > 0
    ? [...new Set(descriptions)].join(' · ')
    : null;
  const screenshotCandidates = selections.flatMap((selection) =>
    selection.screenshots.map((artifact) => ({
      artifact,
      filePath: path.join(selection.sessionDir, artifact.path),
      label: `${selection.manifest.sessionId}/${path.basename(artifact.path)}`,
      sessionId: selection.manifest.sessionId,
    })),
  );
  const screenshots = options.screenshot?.length
    ? options.screenshot.map((selector) => {
        const match = screenshotCandidates.find(
          (candidate) =>
            matchesScreenshotSelector(
              candidate.artifact,
              selector,
              candidate.sessionId,
            ),
        );
        if (!match) {
          throw new Error(`Selected screenshot ordering failed: ${selector}`);
        }
        return match;
      })
    : screenshotCandidates;
  const recordings = selections.flatMap((selection) =>
    selection.video
      ? [
          {
            filePath: path.join(selection.sessionDir, selection.video.path),
            label: selection.manifest.sessionId,
          },
        ]
      : [],
  );
  const errorCount = selections.reduce(
    (total, selection) =>
      total + readIncidentCount(selection.sessionDir, selection.manifest),
    0,
  );
  const verdict = combineVerdicts(selections);
  const userTesting = selections
    .map((selection) => readUserTesting(selection))
    .filter(
      (value): value is { label: string; instructions: string[] } =>
        value !== null,
    );
  const preparedAssets = prepareSelectedAssets(selections);
  if (preparedAssets.length === 0) {
    throw new Error('The selected session has no publishable screenshots or video.');
  }

  // For --dry-run, generate markdown with placeholder URLs (no GitHub dependency).
  if (options.dryRun) {
    const screenshotMap = new Map<string, string>();
    for (const screenshot of screenshots) {
      screenshotMap.set(
        screenshot.label,
        `https://github.com/user-attachments/assets/<${screenshot.label}>`,
      );
    }

    const commentData: PRCommentData = {
      description,
      sessionCount: selections.length,
      screenshots: screenshotMap,
      video: null,
      recordings: recordings.map((recording) => ({
            label: recording.label,
            url: `https://github.com/user-attachments/assets/<${recording.label}>`,
            renderMode: 'embed',
          })),
      errorCount,
      verdict: verdict.status,
      verdictReasons: verdict.reasons,
      userTesting,
      branch: selections[0]?.manifest.branch || target.branch,
      commitSha: selections[0]?.manifest.commitSha || target.headSha,
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
  const repoInfo = await getRepoInfo(token, target.repository);
  assertTargetUnchanged(prNumber, target);

  const uploadRoot = buildUploadRoot(
    prNumber,
    selections.map((selection) => selection.manifest),
  );

  console.log(chalk.dim(`Upload provider: ${uploadProvider}`));
  if (uploadProvider === 'repo-contents') {
    console.log(chalk.dim(`Artifacts branch: ${artifactsBranch}`));
  }
  console.log(chalk.dim(`Uploading ${preparedAssets.length} artifact(s)...`));

  const uploaded = await uploadAssets({
    preparedAssets,
    token,
    repo: repoInfo,
    uploadProvider,
    uploadRoot,
    artifactsBranch,
    onProgress: (current, total, fileName) => {
      console.log(chalk.dim(`  [${current}/${total}] ${fileName}`));
    },
  });

  if (uploaded.size !== preparedAssets.length) {
    throw new Error(
      `Only ${uploaded.size}/${preparedAssets.length} artifacts uploaded. PR comment was not posted.`,
    );
  }

  const screenshotMap = new Map<string, string>();
  for (const screenshot of screenshots) {
    const asset = uploaded.get(screenshot.filePath);
    if (!asset) {
      throw new Error(`Missing uploaded screenshot: ${screenshot.filePath}`);
    }
    screenshotMap.set(screenshot.label, asset.url);
  }

  const uploadedRecordings = recordings.map((recording) => {
    const videoAsset = uploaded.get(recording.filePath);
    if (!videoAsset) {
      throw new Error(`Missing uploaded video: ${recording.filePath}`);
    }
    return {
      label: recording.label,
      url: videoAsset.url,
      renderMode:
        uploadProvider === 'repo-contents'
          ? ('link' as const)
          : ('embed' as const),
    };
  });

  const commentData: PRCommentData = {
    description,
    sessionCount: selections.length,
    screenshots: screenshotMap,
    video: null,
    recordings: uploadedRecordings,
    errorCount,
    verdict: verdict.status,
    verdictReasons: verdict.reasons,
    userTesting,
    branch: selections[0]?.manifest.branch || target.branch,
    commitSha: selections[0]?.manifest.commitSha || target.headSha,
  };

  const commentBody = formatPRComment(commentData);

  assertTargetUnchanged(prNumber, target);
  console.log(chalk.dim('Posting PR comment...'));
  postPRComment(prNumber, commentBody);

  console.log('');
  console.log(chalk.green.bold(`✅ Posted ProofShot verification to PR #${prNumber}`));
  console.log(
    chalk.dim(
      `  ${screenshotMap.size} screenshot(s), ${uploadedRecordings.length} video(s)`,
    ),
  );
}

function assertTargetUnchanged(
  prNumber: number,
  expected: {
    repository: string;
    branch: string;
    headSha: string;
  },
): void {
  const current = getPRHeadProvenance(prNumber);
  if (
    current.repository !== expected.repository ||
    current.branch !== expected.branch ||
    current.headSha !== expected.headSha
  ) {
    throw new Error(
      'The target PR head changed during publication; no PR comment was posted.',
    );
  }
}

function prepareSelectedAssets(
  selections: PublicationSelection[],
): PreparedUploadAsset[] {
  return selections.flatMap((selection) => {
    const artifacts = [
      ...selection.screenshots,
      ...(selection.video ? [selection.video] : []),
    ];
    return artifacts.map((artifact) => {
      const filePath = path.join(selection.sessionDir, artifact.path);
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`Selected artifact is not a regular file: ${artifact.path}`);
      }
      const content = fs.readFileSync(filePath);
      const hash = createHash('sha256').update(content).digest('hex');
      if (hash !== artifact.sha256 || content.length !== artifact.size) {
        throw new Error(`Selected artifact changed after validation: ${artifact.path}`);
      }
      return {
        key: filePath,
        name: path.basename(artifact.path),
        relativeDirectory: path.basename(selection.sessionDir),
        content,
      };
    });
  });
}

function buildUploadRoot(
  prNumber: number,
  manifests: ArtifactManifest[],
): string {
  const sessionId = manifests.length === 1
    ? manifests[0]?.sessionId || 'session'
    : `${manifests.length}-sessions`;
  const safeSessionId =
    sessionId
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'session';
  const manifestHash = createHash('sha256')
    .update(JSON.stringify(manifests))
    .digest('hex')
    .slice(0, 12);
  return path.posix.join(
    'proofshot',
    `pr-${prNumber}`,
    safeSessionId,
    manifestHash,
  );
}

function combineVerdicts(selections: PublicationSelection[]): {
  status: ArtifactManifest['verdict'];
  reasons: string[];
} {
  const summaries = selections.map((selection) => ({
    sessionId: selection.manifest.sessionId,
    ...readVerdictSummary(selection.sessionDir, selection.manifest),
  }));
  const verdictPriority: ArtifactManifest['verdict'][] = [
    'BLOCKED',
    'INCOMPLETE',
    'FAIL',
    'PASS',
  ];
  const status = verdictPriority.find((candidate) =>
    summaries.some((summary) => summary.status === candidate),
  );
  if (!status) {
    throw new Error('No finalized publication verdicts were selected.');
  }
  return {
    status,
    reasons: summaries.flatMap((summary) =>
      summary.reasons.map((reason) => `[${summary.sessionId}] ${reason}`),
    ),
  };
}

function readIncidentCount(
  sessionDir: string,
  manifest: ArtifactManifest,
): number {
  const evidenceArtifact = manifest.artifacts.find(
    (artifact) => artifact.kind === 'evidence',
  );
  if (!evidenceArtifact) return 0;
  try {
    const contents = fs.readFileSync(path.join(sessionDir, evidenceArtifact.path));
    if (
      contents.length !== evidenceArtifact.size ||
      createHash('sha256').update(contents).digest('hex') !==
        evidenceArtifact.sha256
    ) {
      throw new Error('Evidence artifact changed after publication selection.');
    }
    const evidence = JSON.parse(contents.toString('utf-8')) as {
      incidents?: Array<{ count?: number }>;
    };
    return (evidence.incidents || []).reduce(
      (total, incident) => total + (incident.count || 0),
      0,
    );
  } catch (error) {
    throw new Error(
      `Could not read finalized evidence: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function readVerdictSummary(
  sessionDir: string,
  manifest: ArtifactManifest,
): {
  status: ArtifactManifest['verdict'];
  reasons: string[];
} {
  const verdictArtifact = manifest.artifacts.find(
    (artifact) => artifact.kind === 'verdict',
  );
  if (!verdictArtifact) {
    return { status: manifest.verdict, reasons: [] };
  }
  const contents = fs.readFileSync(
    path.join(sessionDir, verdictArtifact.path),
  );
  if (
    contents.length !== verdictArtifact.size ||
    createHash('sha256').update(contents).digest('hex') !==
      verdictArtifact.sha256
  ) {
    throw new Error('Verdict artifact changed after publication selection.');
  }
  const parsed = JSON.parse(contents.toString('utf-8')) as {
    status?: unknown;
    reasons?: unknown;
  };
  if (parsed.status !== manifest.verdict) {
    throw new Error('Verdict artifact does not match the finalized manifest.');
  }
  const reasons = Array.isArray(parsed.reasons)
    ? parsed.reasons.filter(
        (reason): reason is string => typeof reason === 'string',
      )
    : [];
  return { status: manifest.verdict, reasons };
}

function readUserTesting(
  selection: PublicationSelection,
): { label: string; instructions: string[] } | null {
  const artifact = selection.manifest.artifacts.find(
    (candidate) => candidate.kind === 'instructions',
  );
  if (!artifact) return null;
  const contents = fs.readFileSync(path.join(selection.sessionDir, artifact.path));
  if (
    contents.length !== artifact.size ||
    createHash('sha256').update(contents).digest('hex') !== artifact.sha256
  ) {
    throw new Error('User-testing instructions changed after publication selection.');
  }
  const instructions = contents
    .toString('utf-8')
    .split('\n')
    .map((line) => line.match(/^\d+\.\s+(.+)$/)?.[1])
    .filter((line): line is string => Boolean(line));
  if (instructions.length === 0) {
    throw new Error('Finalized user-testing instructions were malformed.');
  }
  return {
    label: selection.manifest.sessionId,
    instructions: instructions.map(
      (instruction) => sanitizeDiagnosticMessage(instruction) || '[REDACTED]',
    ),
  };
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
    options.sessionId === '.' ||
    options.sessionId === '..' ||
    path.basename(options.sessionId) !== options.sessionId
  ) {
    throw new Error(
      'Legacy publication requires an exact --session folder name.',
    );
  }
  const sessionDir = path.join(options.outputDir, options.sessionId);
  const outputRoot = fs.realpathSync(options.outputDir);
  const sessionRoot = fs.realpathSync(sessionDir);
  if (path.dirname(sessionRoot) !== outputRoot) {
    throw new Error('Legacy session must be a direct child of the output directory.');
  }
  const stat = fs.lstatSync(sessionDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Legacy session is not a safe directory.');
  }
  const manifestPath = path.join(sessionDir, 'artifact-manifest.json');
  try {
    fs.lstatSync(manifestPath);
    throw new Error(
      'A finalized manifest entry exists; --legacy-session cannot bypass its validation.',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
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
  if (!provider || provider === 'repo-contents') {
    return 'repo-contents';
  }
  if (provider === 'github-web-attachments') {
    return 'github-web-attachments';
  }

  console.error(
    chalk.red('✗') +
      ` Invalid upload provider "${provider}". Use "repo-contents" or "github-web-attachments".`,
  );
  process.exit(1);
}
