import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimSessionOperation,
  getRegisteredSession,
  listRegisteredSessions,
  registerSession,
  releaseSessionOperation,
  sessionHasLiveOperation,
  unregisterSession,
} from './registry.js';
import type { SessionState } from './state.js';

let root: string;
let registryDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-registry-test-'));
  registryDir = path.join(root, 'sessions');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('session registry', () => {
  it('persists private durable session state atomically', () => {
    const state = buildSession('ps-owned-123');
    registerSession(state, registryDir);

    expect(getRegisteredSession(state.sessionName, registryDir)).toEqual(state);
    expect(listRegisteredSessions(registryDir)).toEqual([state]);
    expect(fs.statSync(registryDir).mode & 0o777).toBe(0o700);
    expect(
      fs.statSync(path.join(registryDir, `${state.sessionName}.json`)).mode & 0o777,
    ).toBe(0o600);
    expect(fs.readdirSync(registryDir)).toEqual([`${state.sessionName}.json`]);
  });

  it('ignores corrupt files and symbolic links', () => {
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(path.join(registryDir, 'corrupt.json'), '{');
    fs.symlinkSync(path.join(registryDir, 'corrupt.json'), path.join(registryDir, 'linked.json'));

    expect(listRegisteredSessions(registryDir)).toEqual([]);
  });

  it('rejects unsafe names and removes exact entries', () => {
    expect(() =>
      registerSession(buildSession('../other'), registryDir),
    ).toThrow(/Invalid ProofShot session name/);

    const state = buildSession('ps-owned-456');
    registerSession(state, registryDir);
    unregisterSession(state.sessionName, registryDir);

    expect(getRegisteredSession(state.sessionName, registryDir)).toBeNull();
  });

  it('claims and releases one immutable operation owner', () => {
    const state = buildSession('ps-owned-operation');

    const lease = claimSessionOperation(state, 'start', registryDir);

    expect(sessionHasLiveOperation(state, registryDir)).toBe(true);
    expect(getRegisteredSession(state.sessionName, registryDir)?.operationLease).toEqual(
      lease,
    );
    expect(() => claimSessionOperation(state, 'stop', registryDir)).toThrow(
      /live start operation/,
    );
    const lockPath = path.join(
      registryDir,
      `${state.sessionName}.operation.lock`,
    );
    expect(fs.statSync(lockPath).mode & 0o777).toBe(0o600);

    releaseSessionOperation(state, lease, registryDir);

    expect(fs.existsSync(lockPath)).toBe(false);
    expect(state.operationLease).toBeUndefined();
    expect(
      getRegisteredSession(state.sessionName, registryDir)?.operationLease,
    ).toBeUndefined();
  });

  it('reclaims a lease only after its immutable owner is gone', () => {
    const state = buildSession('ps-stale-operation');
    const staleLease = claimSessionOperation(state, 'start', registryDir);
    const deadOwner = {
      ...staleLease.owner,
      pid: 2_000_000_000,
      processGroupId: 2_000_000_000,
      sessionId: 2_000_000_000,
    };
    const staleState = {
      ...state,
      operationLease: { ...staleLease, owner: deadOwner },
    };
    registerSession(staleState, registryDir);
    fs.writeFileSync(
      path.join(registryDir, `${state.sessionName}.operation.lock`),
      JSON.stringify(staleState.operationLease, null, 2) + '\n',
    );

    const replacement = claimSessionOperation(
      staleState,
      'recovery',
      registryDir,
    );

    expect(replacement.id).not.toBe(staleLease.id);
    expect(replacement.kind).toBe('recovery');
    releaseSessionOperation(staleState, replacement, registryDir);
  });

  it('fails closed when an operation lock is corrupt', () => {
    const state = buildSession('ps-corrupt-operation');
    registerSession(state, registryDir);
    fs.writeFileSync(
      path.join(registryDir, `${state.sessionName}.operation.lock`),
      '{',
      { mode: 0o600 },
    );

    expect(() => claimSessionOperation(state, 'recovery', registryDir)).toThrow(
      /corrupt or unsafe/,
    );
    expect(() => sessionHasLiveOperation(state, registryDir)).toThrow(
      /corrupt or unsafe/,
    );
  });
});

function buildSession(sessionName: string): SessionState {
  const sessionDir = path.join(root, sessionName);
  return {
    startedAt: '2026-08-09T20:00:00.000Z',
    startDirectory: root,
    description: 'registry test',
    outputDir: root,
    sessionDir,
    sessionName,
    videoPath: path.join(sessionDir, 'session.webm'),
    serverErrorLog: path.join(sessionDir, 'server.log'),
    port: 4173,
    serverCommand: null,
    serverAlreadyRunning: true,
    recordingActive: false,
    browserProcess: null,
    serverProcess: null,
  };
}
