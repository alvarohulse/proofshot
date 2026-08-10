import * as fs from 'fs';
import * as path from 'path';
import {
  loadArtifactManifest,
  validateManifestArtifacts,
  type ArtifactManifest,
  type ManifestArtifact,
} from './manifest.js';

export type PublicationSelection = {
  sessionDir: string;
  manifest: ArtifactManifest;
  screenshots: ManifestArtifact[];
  video: ManifestArtifact | null;
};

export function selectPublication(options: {
  outputDir: string;
  sessionId?: string;
  screenshotIds?: string[];
  repository: string;
  branch: string;
  headSha: string;
}): PublicationSelection {
  const sessions = discoverFinalizedSessions(options.outputDir);
  let candidates: Array<{
    sessionDir: string;
    manifest: ArtifactManifest;
  }>;
  if (options.sessionId) {
    candidates = sessions.filter(
      ({ sessionDir, manifest }) =>
        manifest.sessionId === options.sessionId ||
        path.basename(sessionDir) === options.sessionId,
    );
    if (candidates.length === 0) {
      throw new Error(
        `Finalized ProofShot session not found: ${options.sessionId}`,
      );
    }
  } else {
    candidates = sessions.filter(({ manifest }) =>
      isCompatibleManifest(manifest, options),
    );
    if (candidates.length !== 1) {
      const choices = candidates.map(
        ({ manifest }) =>
          `${manifest.sessionId} (${manifest.verdict}, ${manifest.commitSha.slice(0, 7)})`,
      );
      throw new Error(
        candidates.length === 0
          ? 'No complete finalized session matches the target PR head. Use --session to inspect an explicit choice.'
          : `Multiple complete sessions match the target PR head. Choose one with --session:\n${choices.join('\n')}`,
      );
    }
  }

  if (candidates.length > 1) {
    throw new Error(
      `Session ID is ambiguous: ${options.sessionId}. Use the exact session folder name.`,
    );
  }
  const selected = candidates[0];
  assertCompatibleManifest(selected.manifest, options);
  validateManifestArtifacts(selected.sessionDir, selected.manifest);
  assertRequiredManifestArtifacts(selected.manifest);

  const allScreenshots = selected.manifest.artifacts.filter(
    (artifact) => artifact.kind === 'screenshot',
  );
  const screenshots = options.screenshotIds?.length
    ? selectScreenshots(allScreenshots, options.screenshotIds)
    : allScreenshots;
  const videos = selected.manifest.artifacts.filter(
    (artifact) => artifact.kind === 'video',
  );
  if (videos.length > 1) {
    throw new Error('Finalized session contains multiple video artifacts.');
  }
  return {
    ...selected,
    screenshots,
    video: videos[0] || null,
  };
}

export function discoverFinalizedSessions(
  outputDir: string,
): Array<{ sessionDir: string; manifest: ArtifactManifest }> {
  if (!fs.existsSync(outputDir)) {
    return [];
  }
  return fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(outputDir, entry.name))
    .map((sessionDir) => ({
      sessionDir,
      manifest: loadArtifactManifest(sessionDir),
    }))
    .filter(
      (
        entry,
      ): entry is { sessionDir: string; manifest: ArtifactManifest } =>
        entry.manifest !== null,
    )
    .sort((left, right) =>
      right.manifest.finalizedAt.localeCompare(left.manifest.finalizedAt),
    );
}

function isCompatibleManifest(
  manifest: ArtifactManifest,
  target: Pick<
    Parameters<typeof selectPublication>[0],
    'repository' | 'branch' | 'headSha'
  >,
): boolean {
  return (
    manifest.completion === 'complete' &&
    manifest.verdict !== 'INCOMPLETE' &&
    manifest.verdict !== 'BLOCKED' &&
    !manifest.sourceDirty &&
    !manifest.sourceDrift &&
    manifest.repository === target.repository &&
    manifest.branch === target.branch &&
    manifest.commitSha === target.headSha
  );
}

function assertCompatibleManifest(
  manifest: ArtifactManifest,
  target: Pick<
    Parameters<typeof selectPublication>[0],
    'repository' | 'branch' | 'headSha'
  >,
): void {
  const reasons: string[] = [];
  if (manifest.completion !== 'complete') reasons.push('session is incomplete');
  if (manifest.verdict === 'INCOMPLETE' || manifest.verdict === 'BLOCKED') {
    reasons.push(`verdict is ${manifest.verdict}`);
  }
  if (manifest.sourceDirty || manifest.sourceDrift) {
    reasons.push('source drift was detected');
  }
  if (manifest.repository !== target.repository) {
    reasons.push('repository does not match');
  }
  if (manifest.branch !== target.branch) reasons.push('branch does not match');
  if (manifest.commitSha !== target.headSha) {
    reasons.push('commit does not match the target PR head');
  }
  if (reasons.length > 0) {
    throw new Error(
      `Session ${manifest.sessionId} cannot be published: ${reasons.join('; ')}.`,
    );
  }
}

function assertRequiredManifestArtifacts(manifest: ArtifactManifest): void {
  for (const kind of ['evidence', 'verdict'] as const) {
    if (!manifest.artifacts.some((artifact) => artifact.kind === kind)) {
      throw new Error(
        `Finalized session is missing its ${kind} artifact record.`,
      );
    }
  }
}

function selectScreenshots(
  screenshots: ManifestArtifact[],
  requested: string[],
): ManifestArtifact[] {
  const selected: ManifestArtifact[] = [];
  for (const selector of requested) {
    const matches = screenshots.filter(
      (artifact) =>
        artifact.id === selector ||
        artifact.path === selector ||
        path.basename(artifact.path) === selector,
    );
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `Screenshot artifact not found: ${selector}`
          : `Screenshot selector is ambiguous: ${selector}`,
      );
    }
    if (selected.some((artifact) => artifact.id === matches[0].id)) {
      throw new Error(`Screenshot selected more than once: ${selector}`);
    }
    selected.push(matches[0]);
  }
  return selected;
}
