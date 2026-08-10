import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { ArtifactManifest } from './manifest.js';
import {
  selectPublication,
  selectPublications,
} from './publication.js';

const temporaryDirectories: string[] = [];
const TARGET = {
  repository: 'github.com/alvarohulse/proofshot',
  branch: 'feat/provenance',
  headSha: 'a'.repeat(40),
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('provenance-safe publication selection', () => {
  it('selects one compatible session and only requested screenshots', () => {
    const outputDir = makeOutputDirectory();
    makeSession(outputDir, 'session-one');

    const selected = selectPublication({
      outputDir,
      screenshotIds: ['second.png'],
      ...TARGET,
    });

    expect(selected.manifest.sessionId).toBe('session-one');
    expect(selected.screenshots.map((artifact) => artifact.path)).toEqual([
      'second.png',
    ]);
    expect(selected.video?.path).toBe('session.webm');
  });

  it('requires an explicit choice when multiple sessions match', () => {
    const outputDir = makeOutputDirectory();
    makeSession(outputDir, 'session-one');
    makeSession(outputDir, 'session-two');

    expect(() =>
      selectPublication({ outputDir, ...TARGET }),
    ).toThrow(/Multiple complete sessions.*--session/s);
  });

  it('selects multiple explicit sessions and screenshots in CLI order', () => {
    const outputDir = makeOutputDirectory();
    makeSession(outputDir, 'session-one');
    makeSession(outputDir, 'session-two');

    const selections = selectPublications({
      outputDir,
      sessionIds: ['session-two', 'session-one'],
      screenshotIds: [
        'session-two/second.png',
        'session-one/first.png',
      ],
      ...TARGET,
    });

    expect(
      selections.map((selection) => ({
        sessionId: selection.manifest.sessionId,
        screenshots: selection.screenshots.map((artifact) => artifact.path),
      })),
    ).toEqual([
      { sessionId: 'session-two', screenshots: ['second.png'] },
      { sessionId: 'session-one', screenshots: ['first.png'] },
    ]);
  });

  it('rejects duplicate sessions and ambiguous screenshot selectors', () => {
    const outputDir = makeOutputDirectory();
    makeSession(outputDir, 'session-one');
    makeSession(outputDir, 'session-two');

    expect(() =>
      selectPublications({
        outputDir,
        sessionIds: ['session-one', 'session-one'],
        ...TARGET,
      }),
    ).toThrow(/selected more than once/);
    expect(() =>
      selectPublications({
        outputDir,
        sessionIds: ['session-one', 'session-two'],
        screenshotIds: ['first.png'],
        ...TARGET,
      }),
    ).toThrow(/ambiguous/);
  });

  it('rejects mixed commits, incomplete verdicts, and source drift', () => {
    const outputDir = makeOutputDirectory();
    makeSession(outputDir, 'wrong-commit', {
      commitSha: 'b'.repeat(40),
    });
    makeSession(outputDir, 'incomplete', { verdict: 'INCOMPLETE' });
    makeSession(outputDir, 'drifted', { sourceDrift: true });

    for (const sessionId of ['wrong-commit', 'incomplete', 'drifted']) {
      expect(() =>
        selectPublication({ outputDir, sessionId, ...TARGET }),
      ).toThrow(/cannot be published/);
    }
  });

  it('rejects artifact tampering and traversal before upload', () => {
    const outputDir = makeOutputDirectory();
    const sessionDir = makeSession(outputDir, 'tampered');
    fs.appendFileSync(path.join(sessionDir, 'first.png'), 'changed');
    expect(() =>
      selectPublication({
        outputDir,
        sessionId: 'tampered',
        ...TARGET,
      }),
    ).toThrow(/hash mismatch/);

    const traversalDir = makeSession(outputDir, 'traversal');
    const manifestPath = path.join(
      traversalDir,
      'artifact-manifest.json',
    );
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf-8'),
    ) as ArtifactManifest;
    manifest.artifacts[0].path = '../outside.png';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() =>
      selectPublication({
        outputDir,
        sessionId: 'traversal',
        ...TARGET,
      }),
    ).toThrow(/Unsafe artifact path/);
  });
});

function makeOutputDirectory(): string {
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'proofshot-publication-'),
  );
  temporaryDirectories.push(outputDir);
  return outputDir;
}

function makeSession(
  outputDir: string,
  sessionId: string,
  overrides: Partial<ArtifactManifest> = {},
): string {
  const sessionDir = path.join(outputDir, sessionId);
  fs.mkdirSync(sessionDir);
  const files: Array<{
    path: string;
    kind: 'screenshot' | 'video' | 'evidence' | 'verdict';
    contents: string;
  }> = [
    { path: 'first.png', kind: 'screenshot', contents: 'first' },
    { path: 'second.png', kind: 'screenshot', contents: 'second' },
    { path: 'session.webm', kind: 'video', contents: 'video' },
    { path: 'evidence.json', kind: 'evidence', contents: '{}' },
    { path: 'verdict.json', kind: 'verdict', contents: '{"status":"PASS"}' },
  ];
  for (const file of files) {
    fs.writeFileSync(path.join(sessionDir, file.path), file.contents);
  }
  const manifest: ArtifactManifest = {
    version: 1,
    sessionId,
    repository: TARGET.repository,
    branch: TARGET.branch,
    commitSha: TARGET.headSha,
    treeHash: 'tree',
    sourceDirty: false,
    sourceDrift: false,
    startedAt: '2026-08-09T00:00:00.000Z',
    finalizedAt: `2026-08-09T00:00:${sessionId.length}.000Z`,
    completion: 'complete',
    verdict: 'PASS',
    artifacts: files.map((file, order) => ({
      id: `${file.kind}:${file.path}`,
      kind: file.kind,
      path: file.path,
      sha256: createHash('sha256').update(file.contents).digest('hex'),
      size: Buffer.byteLength(file.contents),
      order,
    })),
    ...overrides,
  };
  fs.writeFileSync(
    path.join(sessionDir, 'artifact-manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  return sessionDir;
}
