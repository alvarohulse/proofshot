import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discardSession, stopOwnedServer } from './lifecycle.js';
import type { SessionState } from './state.js';

const mocks = vi.hoisted(() => ({
  stopRecording: vi.fn(),
  closeBrowser: vi.fn(),
  setAgentBrowserDefaults: vi.fn(),
  getProcessStartTime: vi.fn(),
  isProcessRunning: vi.fn(),
  processHasEnvironmentValue: vi.fn(),
  terminateProcessTree: vi.fn(),
  waitForProcessExit: vi.fn(),
  unregisterSession: vi.fn(),
  clearSession: vi.fn(),
}));

vi.mock('../browser/capture.js', () => ({
  stopRecording: mocks.stopRecording,
}));

vi.mock('../browser/session.js', () => ({
  closeBrowser: mocks.closeBrowser,
}));

vi.mock('../utils/exec.js', () => ({
  setAgentBrowserDefaults: mocks.setAgentBrowserDefaults,
}));

vi.mock('../utils/process.js', () => ({
  getProcessStartTime: mocks.getProcessStartTime,
  isProcessRunning: mocks.isProcessRunning,
  processHasEnvironmentValue: mocks.processHasEnvironmentValue,
  terminateProcessTree: mocks.terminateProcessTree,
  waitForProcessExit: mocks.waitForProcessExit,
}));

vi.mock('../server/start.js', () => ({
  SERVER_OWNERSHIP_ENV: 'PROOFSHOT_SERVER_TOKEN',
}));

vi.mock('./registry.js', () => ({
  unregisterSession: mocks.unregisterSession,
}));

vi.mock('./state.js', () => ({
  clearSession: mocks.clearSession,
}));

describe('session lifecycle', () => {
  beforeEach(() => {
    mocks.isProcessRunning.mockReturnValueOnce(true).mockReturnValue(false);
    mocks.processHasEnvironmentValue.mockReturnValue(true);
    mocks.waitForProcessExit.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('terminates a server started by ProofShot', () => {
    const session = buildSession({ serverAlreadyRunning: false, serverPid: 1234 });

    expect(stopOwnedServer(session)).toBe('stopped');
    expect(mocks.processHasEnvironmentValue).toHaveBeenCalledWith(
      1234,
      'PROOFSHOT_SERVER_TOKEN',
      'ownership-token',
    );
    expect(mocks.terminateProcessTree).toHaveBeenCalledWith(1234);
  });

  it('does not terminate an external server', () => {
    const session = buildSession({ serverAlreadyRunning: true, serverPid: 1234 });

    expect(stopOwnedServer(session)).toBe('not-owned');
    expect(mocks.terminateProcessTree).not.toHaveBeenCalled();
  });

  it('refuses to terminate a reused PID', () => {
    const session = buildSession({ serverAlreadyRunning: false, serverPid: 1234 });
    mocks.processHasEnvironmentValue.mockReturnValue(false);

    expect(() => stopOwnedServer(session)).toThrow('ownership could not be verified');
    expect(mocks.terminateProcessTree).not.toHaveBeenCalled();
  });

  it('does not use second-resolution start time as Unix ownership proof', () => {
    const session = buildSession({
      serverAlreadyRunning: false,
      serverPid: 1234,
      serverProcessStartTime: 'start-time',
    });
    mocks.processHasEnvironmentValue.mockReturnValue(false);
    mocks.getProcessStartTime.mockReturnValue('start-time');
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

    expect(() => stopOwnedServer(session)).toThrow('ownership could not be verified');
  });

  it('verifies ownership by process start time when environment inspection is unavailable', () => {
    const session = buildSession({
      serverAlreadyRunning: false,
      serverPid: 1234,
      serverProcessStartTime: 'start-time',
    });
    mocks.processHasEnvironmentValue.mockReturnValue(null);
    mocks.getProcessStartTime.mockReturnValue('start-time');
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

    expect(stopOwnedServer(session)).toBe('stopped');
    expect(mocks.terminateProcessTree).toHaveBeenCalledWith(1234);
  });

  it('discards browser, server, artifact state, and registry state together', () => {
    const session = buildSession({
      browserConfigPath: '/work/agent-browser.json',
      serverAlreadyRunning: false,
      serverPid: 1234,
    });

    discardSession(session);

    expect(mocks.setAgentBrowserDefaults).toHaveBeenCalledWith({
      configPath: '/work/agent-browser.json',
    });
    expect(mocks.stopRecording).toHaveBeenCalledWith(session.sessionName);
    expect(mocks.closeBrowser).toHaveBeenCalledWith(session.sessionName);
    expect(mocks.terminateProcessTree).toHaveBeenCalledWith(1234);
    expect(mocks.clearSession).toHaveBeenCalledWith(
      session.outputDir,
      session.sessionName,
    );
    expect(mocks.unregisterSession).toHaveBeenCalledWith(session.sessionName);
  });

  function buildSession(overrides: Partial<SessionState>): SessionState {
    return {
      startedAt: '2026-07-16T18:00:00.000Z',
      startDirectory: '/work/project',
      description: null,
      outputDir: '/artifacts',
      sessionDir: '/artifacts/proofshot-test',
      sessionName: 'proofshot-test',
      headless: true,
      videoPath: '/artifacts/proofshot-test/session.webm',
      serverErrorLog: '/artifacts/proofshot-test/server.log',
      port: 3000,
      serverCommand: 'npm run dev',
      serverOwnershipToken: 'ownership-token',
      serverPid: null,
      serverAlreadyRunning: false,
      recordingActive: true,
      viewport: { width: 2560, height: 1440 },
      ...overrides,
    };
  }
});
