import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionCleanCommand, sessionListCommand } from './session.js';
import type { SessionState } from '../session/state.js';

const mocks = vi.hoisted(() => ({
  discardSession: vi.fn(),
  isSessionStillStarting: vi.fn(),
  stopOwnedServer: vi.fn(),
  listActiveBrowserSessionNames: vi.fn(),
  listRegisteredSessions: vi.fn(),
  unregisterSession: vi.fn(),
  clearSession: vi.fn(),
}));

vi.mock('../session/lifecycle.js', () => ({
  discardSession: mocks.discardSession,
  isSessionStillStarting: mocks.isSessionStillStarting,
  stopOwnedServer: mocks.stopOwnedServer,
}));

vi.mock('../session/registry.js', () => ({
  listActiveBrowserSessionNames: mocks.listActiveBrowserSessionNames,
  listRegisteredSessions: mocks.listRegisteredSessions,
  unregisterSession: mocks.unregisterSession,
}));

vi.mock('../session/state.js', () => ({
  clearSession: mocks.clearSession,
}));

describe('session commands', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.isSessionStillStarting.mockReturnValue(false);
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('lists active and orphaned sessions as JSON', async () => {
    mocks.listRegisteredSessions.mockReturnValue([
      buildSession('proofshot-active'),
      buildSession('proofshot-orphaned'),
    ]);
    mocks.listActiveBrowserSessionNames.mockReturnValue(new Set(['proofshot-active']));

    await sessionListCommand({ json: true });

    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.sessions).toMatchObject([
      { id: 'proofshot-active', status: 'active' },
      { id: 'proofshot-orphaned', status: 'orphaned' },
    ]);
  });

  it('cleans only orphaned sessions by default', async () => {
    const activeSession = buildSession('proofshot-active');
    const orphanedSession = buildSession('proofshot-orphaned');
    mocks.listRegisteredSessions.mockReturnValue([activeSession, orphanedSession]);
    mocks.listActiveBrowserSessionNames.mockReturnValue(new Set(['proofshot-active']));

    await sessionCleanCommand({});

    expect(mocks.discardSession).not.toHaveBeenCalled();
    expect(mocks.stopOwnedServer).toHaveBeenCalledWith(orphanedSession);
    expect(mocks.clearSession).toHaveBeenCalledWith(
      orphanedSession.outputDir,
      orphanedSession.sessionName,
    );
    expect(mocks.unregisterSession).toHaveBeenCalledWith(orphanedSession.sessionName);
  });

  it('reports unknown status when agent-browser cannot be inspected', async () => {
    mocks.listRegisteredSessions.mockReturnValue([buildSession('proofshot-unknown')]);
    mocks.listActiveBrowserSessionNames.mockImplementation(() => {
      throw new Error('agent-browser unavailable');
    });

    await sessionListCommand({ json: true });

    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(JSON.parse(output).sessions).toMatchObject([
      { id: 'proofshot-unknown', status: 'unknown' },
    ]);
  });

  it('stops active sessions when cleaning all', async () => {
    const activeSession = buildSession('proofshot-active');
    mocks.listRegisteredSessions.mockReturnValue([activeSession]);
    mocks.listActiveBrowserSessionNames.mockReturnValue(new Set(['proofshot-active']));

    await sessionCleanCommand({ all: true });

    expect(mocks.listActiveBrowserSessionNames).not.toHaveBeenCalled();
    expect(mocks.discardSession).toHaveBeenCalledWith(activeSession);
  });

  it('preserves session state when owned-server cleanup fails', async () => {
    const orphanedSession = buildSession('proofshot-orphaned');
    mocks.listRegisteredSessions.mockReturnValue([orphanedSession]);
    mocks.listActiveBrowserSessionNames.mockReturnValue(new Set());
    mocks.stopOwnedServer.mockImplementation(() => {
      throw new Error('ownership could not be verified');
    });

    await sessionCleanCommand({});

    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.unregisterSession).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  function buildSession(sessionName: string): SessionState {
    return {
      startedAt: '2026-07-16T18:00:00.000Z',
      startDirectory: '/work/project',
      description: null,
      outputDir: '/artifacts',
      sessionDir: `/artifacts/${sessionName}`,
      sessionName,
      headless: true,
      videoPath: `/artifacts/${sessionName}/session.webm`,
      serverErrorLog: `/artifacts/${sessionName}/server.log`,
      port: 3000,
      serverCommand: null,
      serverPid: null,
      serverAlreadyRunning: true,
      recordingActive: true,
      viewport: { width: 2560, height: 1440 },
    };
  }
});
