import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getRegisteredSession,
  listRegisteredSessions,
  registerSession,
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
