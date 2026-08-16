import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canAddressOwnedBrowserSession: vi.fn(),
  claimSessionOperation: vi.fn(),
  cleanupFailedStart: vi.fn(),
  getRegisteredSession: vi.fn(),
  listRegisteredSessions: vi.fn(),
  registerSession: vi.fn(),
  releaseSessionOperation: vi.fn(),
  unregisterSession: vi.fn(),
  clearSession: vi.fn(),
  hasActiveSession: vi.fn(),
  loadSession: vi.fn(),
  saveSession: vi.fn(),
  setAgentBrowserDefaults: vi.fn(),
  backfillSessionAgentBrowserRuntime: vi.fn(),
  ownedProcessTreeIsAlive: vi.fn(),
}));

vi.mock('../session/lifecycle.js', () => ({
  canAddressOwnedBrowserSession: mocks.canAddressOwnedBrowserSession,
  cleanupFailedStart: mocks.cleanupFailedStart,
}));
vi.mock('../session/registry.js', () => ({
  claimSessionOperation: mocks.claimSessionOperation,
  getRegisteredSession: mocks.getRegisteredSession,
  listRegisteredSessions: mocks.listRegisteredSessions,
  registerSession: mocks.registerSession,
  releaseSessionOperation: mocks.releaseSessionOperation,
  unregisterSession: mocks.unregisterSession,
}));
vi.mock('../session/state.js', () => ({
  clearSession: mocks.clearSession,
  hasActiveSession: mocks.hasActiveSession,
  loadSession: mocks.loadSession,
  saveSession: mocks.saveSession,
}));
vi.mock('../utils/exec.js', () => ({
  setAgentBrowserDefaults: mocks.setAgentBrowserDefaults,
}));
vi.mock('../session/browser-runtime.js', () => ({
  backfillSessionAgentBrowserRuntime:
    mocks.backfillSessionAgentBrowserRuntime,
}));
vi.mock('../utils/process.js', () => ({
  ownedProcessTreeIsAlive: mocks.ownedProcessTreeIsAlive,
}));

import { sessionCleanCommand, sessionListCommand } from './session.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.canAddressOwnedBrowserSession.mockReturnValue(false);
  mocks.cleanupFailedStart.mockResolvedValue(undefined);
  mocks.claimSessionOperation.mockImplementation((session) => {
    const lease = {
      id: 'recovery-lease',
      kind: 'recovery',
      owner: {
        pid: process.pid,
        processGroupId: process.pid,
        sessionId: process.pid,
        startTime: 'test',
      },
      startedAt: new Date().toISOString(),
    };
    session.operationLease = lease;
    return lease;
  });
  mocks.releaseSessionOperation.mockImplementation((session) => {
    delete session.operationLease;
  });
  mocks.hasActiveSession.mockReturnValue(true);
  mocks.ownedProcessTreeIsAlive.mockReturnValue(false);
  mocks.backfillSessionAgentBrowserRuntime.mockReturnValue(false);
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

  it('cleans one exact registered session and removes its registry record', async () => {
    const session = buildSession({ lifecycleStatus: 'recovery' });
    mocks.getRegisteredSession.mockReturnValue(session);

    await sessionCleanCommand({ session: session.sessionName });

    expect(mocks.cleanupFailedStart).toHaveBeenCalledWith(session);
    expect(mocks.setAgentBrowserDefaults).toHaveBeenCalledWith({
      allowedDomains: session.agentBrowserAllowedDomains,
      configPath: session.agentBrowserConfigPath,
      executablePath: session.agentBrowserExecutablePath,
      namespace: session.agentBrowserNamespace,
      socketDir: session.agentBrowserSocketDir,
    });
    expect(mocks.unregisterSession).toHaveBeenCalledWith(session.sessionName);
  });

  it('retains recovery state when exact cleanup still fails', async () => {
    const session = buildSession({ lifecycleStatus: 'recovery' });
    mocks.getRegisteredSession.mockReturnValue(session);
    mocks.cleanupFailedStart.mockRejectedValue(new Error('identity mismatch'));

    await sessionCleanCommand({ session: session.sessionName });

    expect(session.cleanupError).toBe('identity mismatch');
    expect(mocks.registerSession).toHaveBeenCalledWith(session);
    expect(mocks.unregisterSession).not.toHaveBeenCalled();
  });

  it('refuses to clean an addressable live browser session', async () => {
    const session = buildSession({ lifecycleStatus: 'recovery' });
    mocks.getRegisteredSession.mockReturnValue(session);
    mocks.canAddressOwnedBrowserSession.mockReturnValue(true);

    await sessionCleanCommand({ session: session.sessionName });

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('browser session is still live'),
    );
    expect(mocks.cleanupFailedStart).not.toHaveBeenCalled();
    expect(mocks.unregisterSession).not.toHaveBeenCalled();
  });

  it('persists an exact runtime before cleaning a legacy session', async () => {
    const session = buildSession({ agentBrowserExecutablePath: undefined });
    mocks.getRegisteredSession.mockReturnValue(session);
    mocks.backfillSessionAgentBrowserRuntime.mockImplementation(
      (legacySession) => {
        legacySession.agentBrowserExecutablePath =
          '/opt/node24/bin/agent-browser';
        legacySession.agentBrowserVersion = '0.34.0';
        return true;
      },
    );

    await sessionCleanCommand({ session: session.sessionName });

    expect(mocks.registerSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentBrowserExecutablePath: '/opt/node24/bin/agent-browser',
        agentBrowserVersion: '0.34.0',
      }),
    );
    expect(mocks.setAgentBrowserDefaults).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: '/opt/node24/bin/agent-browser',
      }),
    );
  });

  it('does not unregister another concurrent session', async () => {
    const session = buildSession({ lifecycleStatus: 'recovery' });
    mocks.getRegisteredSession.mockReturnValue(session);

    await sessionCleanCommand({ session: session.sessionName });

    expect(mocks.unregisterSession).toHaveBeenCalledTimes(1);
    expect(mocks.unregisterSession).toHaveBeenCalledWith(session.sessionName);
    expect(mocks.unregisterSession).not.toHaveBeenCalledWith('ps-newer-session');
  });
});

function buildSession(overrides: Record<string, unknown> = {}): any {
  return {
    startedAt: '2026-08-09T20:00:00.000Z',
    startDirectory: '/project',
    description: 'session command test',
    outputDir: '/project/proofshot-artifacts',
    controlDir: '/project/control',
    sessionDir: '/project/proofshot-artifacts/run',
    sessionName: 'ps-session-test',
    videoPath: '/project/proofshot-artifacts/run/session.webm',
    serverErrorLog: '/project/proofshot-artifacts/run/server.log',
    port: 4173,
    serverCommand: null,
    serverAlreadyRunning: true,
    recordingActive: false,
    agentBrowserExecutablePath: '/opt/node24/bin/agent-browser',
    browserLaunchAttempted: false,
    browserProcess: null,
    serverProcess: null,
    ...overrides,
  };
}
