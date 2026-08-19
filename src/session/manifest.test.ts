import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import type { CanonicalEvidence, Verdict } from '../artifacts/evidence.js';
import {
  captureGitProvenance,
  loadArtifactManifest,
  normalizeRepository,
  resolveGitRepositoryRoot,
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
  it('captures the full repository when started from a subdirectory', () => {
    const repositoryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-git-root-'),
    );
    temporaryDirectories.push(repositoryRoot);
    runGit(repositoryRoot, ['init']);
    runGit(repositoryRoot, ['config', 'user.email', 'proofshot@example.test']);
    runGit(repositoryRoot, ['config', 'user.name', 'ProofShot Test']);
    runGit(repositoryRoot, [
      'remote',
      'add',
      'origin',
      'https://github.com/alvarohulse/proofshot.git',
    ]);
    fs.writeFileSync(path.join(repositoryRoot, 'tracked.txt'), 'tracked\n');
    runGit(repositoryRoot, ['add', 'tracked.txt']);
    runGit(repositoryRoot, ['commit', '-m', 'test: initialize fixture']);
    const subdirectory = path.join(repositoryRoot, 'packages', 'fixture');
    fs.mkdirSync(subdirectory, { recursive: true });

    const clean = captureGitProvenance(subdirectory);
    expect(resolveGitRepositoryRoot(subdirectory)).toBe(repositoryRoot);
    expect(clean.repository).toBe('github.com/alvarohulse/proofshot');
    expect(clean.sourceDirty).toBe(false);

    fs.writeFileSync(path.join(repositoryRoot, 'outside-subdirectory.txt'), 'dirty\n');
    expect(captureGitProvenance(subdirectory).sourceDirty).toBe(true);

    fs.unlinkSync(path.join(repositoryRoot, 'outside-subdirectory.txt'));
    const outputDirectory = path.join(repositoryRoot, 'proofshot-artifacts');
    fs.mkdirSync(outputDirectory);
    fs.writeFileSync(path.join(outputDirectory, 'session.json'), '{}\n');
    expect(
      captureGitProvenance(subdirectory, [outputDirectory]).sourceDirty,
    ).toBe(false);
  });

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
    fs.mkdirSync(path.join(sessionDir, 'private', 'browser'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(sessionDir, 'private', 'browser', 'console-output.log'),
      'Authorization: Basic private-manifest-secret',
    );
    for (const [file, contents] of [
      ['second.png', 'second'],
      ['first.png', 'first'],
      ['session.webm', 'video'],
      ['evidence.json', '{}'],
      ['verdict.json', '{"status":"PASS"}'],
      ['USER_TESTING.md', '# User Testing\n\n1. Verify the flow.\n'],
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
      runtime: {
        contract: 'managed-preflight-v1',
        launcherSha256: 'a'.repeat(64),
        nativeSha256: 'b'.repeat(64),
        nodeVersion: 'v24.19.0',
        version: '0.34.0',
      },
    });

    expect(manifest.sourceDrift).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain(sessionDir);
    expect(manifest.runtime).toMatchObject({
      contract: 'managed-preflight-v1',
      nativeSha256: 'b'.repeat(64),
    });
    expect(
      manifest.artifacts
        .filter((artifact) => artifact.kind === 'screenshot')
        .map((artifact) => artifact.path),
    ).toEqual(['first.png', 'second.png']);
    expect(
      manifest.artifacts.find(
        (artifact) => artifact.path === 'logs/frontend.log',
      ),
    ).toBeUndefined();
    expect(
      manifest.artifacts.find(
        (artifact) => artifact.path === 'USER_TESTING.md',
      )?.kind,
    ).toBe('instructions');
    expect(loadArtifactManifest(sessionDir)).toEqual(manifest);
    expect(JSON.stringify(manifest)).not.toContain('private-manifest-secret');
    expect(
      manifest.artifacts.some((artifact) => artifact.path.startsWith('private/')),
    ).toBe(false);
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

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
