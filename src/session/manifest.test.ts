import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CanonicalEvidence, Verdict } from '../artifacts/evidence.js';
import {
  loadArtifactManifest,
  validateManifestArtifacts,
  writeArtifactManifest,
  type GitProvenance,
} from './manifest.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('finalized artifact manifests', () => {
  it('records ordered hashes and nested evidence with stable provenance', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-manifest-'),
    );
    temporaryDirectories.push(sessionDir);
    fs.mkdirSync(path.join(sessionDir, 'logs'));
    for (const [file, contents] of [
      ['second.png', 'second'],
      ['first.png', 'first'],
      ['session.webm', 'video'],
      ['evidence.json', '{}'],
      ['verdict.json', '{"status":"PASS"}'],
      ['logs/frontend.log', 'vite'],
    ]) {
      fs.writeFileSync(path.join(sessionDir, file), contents);
    }
    const provenance: GitProvenance = {
      repository: 'github.com/alvarohulse/proofshot',
      branch: 'feat/provenance',
      commitSha: 'a'.repeat(40),
      treeHash: 'tree',
      sourceDirty: false,
    };
    const evidence = {
      actions: [
        {
          action: 'screenshot first.png',
          relativeTimeSec: 1,
          timestamp: '2026-08-09T00:00:01.000Z',
        },
        {
          action: 'screenshot second.png',
          relativeTimeSec: 2,
          timestamp: '2026-08-09T00:00:02.000Z',
        },
      ],
    } as CanonicalEvidence;
    const verdict = { status: 'PASS' } as Verdict;

    const manifest = writeArtifactManifest({
      sessionId: 'proofshot-one',
      sessionDir,
      metadata: {
        ...provenance,
        repositoryRoot: sessionDir,
        startedAt: '2026-08-09T00:00:00.000Z',
        description: null,
      },
      evidence,
      verdict,
      finalizedProvenance: provenance,
    });

    expect(manifest.sourceDrift).toBe(false);
    expect(
      manifest.artifacts
        .filter((artifact) => artifact.kind === 'screenshot')
        .map((artifact) => artifact.path),
    ).toEqual(['first.png', 'second.png']);
    expect(
      manifest.artifacts.find(
        (artifact) => artifact.path === 'logs/frontend.log',
      ),
    ).toBeDefined();
    expect(loadArtifactManifest(sessionDir)).toEqual(manifest);
    expect(() =>
      validateManifestArtifacts(sessionDir, manifest),
    ).not.toThrow();
  });
});
