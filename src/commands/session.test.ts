import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cleanupFailedStart: vi.fn(),
  getRegisteredSession: vi.fn(),
  listRegisteredSessions: vi.fn(),
  registerSession: vi.fn(),
  unregisterSession: vi.fn(),
  clearSession: vi.fn(),
  saveSession: vi.fn(),
  ownedProcessTreeIsAlive: vi.fn(),
}));

vi.mock('../session/lifecycle.js', () => ({
  cleanupFailedStart: mocks.cleanupFailedStart,
}));
vi.mock('../session/registry.js', () => ({
  getRegisteredSession: mocks.getRegisteredSession,
  listRegisteredSessions: mocks.listRegisteredSessions,
  registerSession: mocks.registerSession,
  unregisterSession: mocks.unregisterSession,
}));
vi.mock('../session/state.js', () => ({
  clearSession: mocks.clearSession,
  saveSession: mocks.saveSession,
}));
vi.mock('../utils/process.js', () => ({
  ownedProcessTreeIsAlive: mocks.ownedProcessTreeIsAlive,
}));

import { sessionCleanCommand, sessionListCommand } from './session.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.cleanupFailedStart.mockResolvedValue(undefined);
  mocks.ownedProcessTreeIsAlive.mockReturnValue(false);
});

afterEach(() => {
  process.exitCode = 0;
  vi.restoreAllMocks();
});

describe('session commands', () => {
  it('lists recovery state as machine-readable inventory', async () => {
    mocks.listRegisteredSessions.mockReturnValue([
      buildSession({ lifecycleStatus: 'recovery', cleanupError: 'daemon still alive' }),
    ]);

    await sessionListCommand({ json: true });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"status": "recovery"'),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"cleanupError": "daemon still alive"'),
    );
  });

  it('cleans one exact registered session and removes both state records', async () => {
    const session = buildSession({ lifecycleStatus: 'recovery' });
    mocks.getRegisteredSession.mockReturnValue(session);

    await sessionCleanCommand({ session: session.sessionName });

    expect(mocks.cleanupFailedStart).toHaveBeenCalledWith(session);
    expect(mocks.clearSession).toHaveBeenCalledWith(session.outputDir);
    expect(mocks.unregisterSession).toHaveBeenCalledWith(session.sessionName);
  });

  it('retains recovery state when exact cleanup still fails', async () => {
    const session = buildSession({ lifecycleStatus: 'recovery' });
    mocks.getRegisteredSession.mockReturnValue(session);
    mocks.cleanupFailedStart.mockRejectedValue(new Error('identity mismatch'));

    await sessionCleanCommand({ session: session.sessionName });

    expect(session.cleanupError).toBe('identity mismatch');
    expect(mocks.saveSession).toHaveBeenCalledWith(session, session.outputDir);
    expect(mocks.registerSession).toHaveBeenCalledWith(session);
    expect(mocks.unregisterSession).not.toHaveBeenCalled();
  });
});

function buildSession(overrides: Record<string, unknown> = {}): any {
  return {
    startedAt: '2026-08-09T20:00:00.000Z',
    startDirectory: '/project',
    description: 'session command test',
    outputDir: '/project/proofshot-artifacts',
    sessionDir: '/project/proofshot-artifacts/run',
    sessionName: 'ps-session-test',
    videoPath: '/project/proofshot-artifacts/run/session.webm',
    serverErrorLog: '/project/proofshot-artifacts/run/server.log',
    port: 4173,
    serverCommand: null,
    serverAlreadyRunning: true,
    recordingActive: false,
    browserLaunchAttempted: false,
    browserProcess: null,
    serverProcess: null,
    ...overrides,
  };
}
