import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listActiveBrowserSessionNames,
  listRegisteredSessions,
  registerSession,
  reserveSession,
  resolveSession,
  SessionSelectionError,
  unregisterSession,
} from './registry.js';
import { saveSession, type SessionState } from './state.js';

const mocks = vi.hoisted(() => ({
  ab: vi.fn(),
}));

vi.mock('../utils/exec.js', () => ({
  ab: mocks.ab,
}));

describe('session registry', () => {
  let registryDir: string;

  beforeEach(() => {
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-registry-'));
  });

  afterEach(() => {
    fs.rmSync(registryDir, { recursive: true, force: true });
    mocks.ab.mockReset();
  });

  it('registers, lists, and unregisters sessions', () => {
    const session = buildSession('proofshot-first', '/work/first');

    registerSession(session, registryDir);

    expect(listRegisteredSessions(registryDir)).toEqual([session]);

    unregisterSession(session.sessionName, registryDir);
    expect(listRegisteredSessions(registryDir)).toEqual([]);
  });

  it('reserves session names atomically', () => {
    const session = buildSession('proofshot-first', '/work/first');
    reserveSession(session, registryDir);

    expect(() => reserveSession(session, registryDir)).toThrow();

    unregisterSession('proofshot-first', registryDir);
    expect(() => reserveSession(session, registryDir)).not.toThrow();
  });

  it('resolves a session started from the current directory', () => {
    registerSession(buildSession('proofshot-first', '/work/first'), registryDir);
    registerSession(buildSession('proofshot-second', '/work/second'), registryDir);

    expect(
      resolveSession({
        workingDirectory: '/work/second',
        registryDir,
      })?.sessionName,
    ).toBe('proofshot-second');
  });

  it('resolves an explicit session from another directory', () => {
    registerSession(buildSession('proofshot-first', '/work/first'), registryDir);
    registerSession(buildSession('proofshot-second', '/work/second'), registryDir);

    expect(
      resolveSession({
        sessionName: 'proofshot-first',
        workingDirectory: '/different/directory',
        registryDir,
      })?.sessionName,
    ).toBe('proofshot-first');
  });

  it('requires explicit selection when multiple sessions are ambiguous', () => {
    registerSession(buildSession('proofshot-first', '/work/first'), registryDir);
    registerSession(buildSession('proofshot-second', '/work/second'), registryDir);

    expect(() =>
      resolveSession({
        workingDirectory: '/different/directory',
        registryDir,
      }),
    ).toThrow(SessionSelectionError);
  });

  it('ignores orphaned entries during automatic selection', () => {
    registerSession(buildSession('proofshot-orphaned', '/work/orphaned'), registryDir);
    registerSession(buildSession('proofshot-active', '/work/active'), registryDir);

    expect(
      resolveSession({
        workingDirectory: '/different/directory',
        registryDir,
        activeBrowserSessionNames: new Set(['proofshot-active']),
      })?.sessionName,
    ).toBe('proofshot-active');
  });

  it('does not fall through to an unscoped browser when all sessions are orphaned', () => {
    registerSession(buildSession('proofshot-orphaned', '/work/orphaned'), registryDir);

    expect(() =>
      resolveSession({
        workingDirectory: '/work/orphaned',
        registryDir,
        activeBrowserSessionNames: new Set(),
      }),
    ).toThrow('Only orphaned ProofShot sessions were found');
  });

  it('merges a matching legacy session before selecting a global session', () => {
    const legacyOutputDir = path.join(registryDir, 'legacy-output');
    fs.mkdirSync(legacyOutputDir, { recursive: true });
    const legacySession = buildSession('proofshot-legacy', '/work/legacy');
    legacySession.outputDir = legacyOutputDir;
    saveSession(legacySession);
    registerSession(buildSession('proofshot-global', '/work/global'), registryDir);

    expect(
      resolveSession({
        workingDirectory: '/work/legacy',
        legacyOutputDir,
        registryDir,
      })?.sessionName,
    ).toBe('proofshot-legacy');
  });

  it('ignores malformed registry records', () => {
    fs.writeFileSync(
      path.join(registryDir, 'proofshot-malformed.json'),
      JSON.stringify({
        sessionName: 'proofshot-malformed',
        startedAt: '2026-07-16T18:00:00.000Z',
        outputDir: '/artifacts',
        sessionDir: '/artifacts/session',
      }),
    );

    expect(listRegisteredSessions(registryDir)).toEqual([]);
  });

  it('parses active agent-browser session names', () => {
    mocks.ab.mockReturnValue(
      JSON.stringify({
        success: true,
        data: { sessions: ['proofshot-first', 'unrelated'] },
      }),
    );

    expect(listActiveBrowserSessionNames()).toEqual(
      new Set(['proofshot-first', 'unrelated']),
    );
  });

  function buildSession(sessionName: string, startDirectory: string): SessionState {
    return {
      startedAt: '2026-07-16T18:00:00.000Z',
      startDirectory,
      description: null,
      outputDir: path.join(startDirectory, 'proofshot-artifacts'),
      sessionDir: path.join(startDirectory, 'proofshot-artifacts', sessionName),
      sessionName,
      headless: true,
      videoPath: path.join(startDirectory, 'proofshot-artifacts', sessionName, 'session.webm'),
      serverErrorLog: path.join(startDirectory, 'proofshot-artifacts', sessionName, 'server.log'),
      port: 3000,
      serverCommand: null,
      serverPid: null,
      serverAlreadyRunning: true,
      recordingActive: true,
      viewport: { width: 2560, height: 1440 },
    };
  }

});
