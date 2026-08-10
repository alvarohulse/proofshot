import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CanonicalEvidence, Verdict } from '../artifacts/evidence.js';
import {
  loadArtifactManifest,
  normalizeRepository,
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
  it('strips credentials from repository remotes', () => {
    expect(
      normalizeRepository(
        'https://x-access-token:secret@github.com/alvarohulse/proofshot.git',
      ),
    ).toBe('github.com/alvarohulse/proofshot');
    expect(normalizeRepository('git@github.com:alvarohulse/proofshot.git')).toBe(
      'github.com/alvarohulse/proofshot',
    );
    expect(
      normalizeRepository(
        'ssh://git@github.com:2222/alvarohulse/proofshot.git',
      ),
    ).toBe('github.com/alvarohulse/proofshot');
  });

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
      screenshots: [
        {
          file: 'first.png',
          validPng: true,
          visuallyBlank: false,
          sha256: 'fixture',
        },
        {
          file: 'second.png',
          validPng: true,
          visuallyBlank: false,
          sha256: 'fixture',
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

    const duplicatePathManifest = structuredClone(manifest);
    const duplicate = duplicatePathManifest.artifacts[1];
    if (!duplicate) {
      throw new Error('Expected a second manifest artifact.');
    }
    duplicate.path = duplicatePathManifest.artifacts[0]?.path || '';
    expect(() =>
      validateManifestArtifacts(sessionDir, duplicatePathManifest),
    ).toThrow(/Duplicate artifact path/);
  });
});
