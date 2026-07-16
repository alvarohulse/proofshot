import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCommand } from './start.js';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  ensureDevServer: vi.fn(),
  openBrowser: vi.fn(),
  closeBrowser: vi.fn(),
  startRecording: vi.fn(),
  ensureOutputDir: vi.fn(),
  generateTimestamp: vi.fn(),
  generateSessionDirName: vi.fn(),
  saveSession: vi.fn(),
  hasActiveSession: vi.fn(),
  clearSession: vi.fn(),
  loadSession: vi.fn(),
  reserveOutputSession: vi.fn(),
  generateAgentBrowserSessionName: vi.fn(),
  listRegisteredSessions: vi.fn(),
  registerSession: vi.fn(),
  reserveSession: vi.fn(),
  unregisterSession: vi.fn(),
  discardSession: vi.fn(),
  isSessionStillStarting: vi.fn(),
  terminateProcessTree: vi.fn(),
  isProcessRunning: vi.fn(),
  writeMetadata: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('../utils/config.js', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../server/start.js', () => ({
  DevServerStartError: class DevServerStartError extends Error {},
  ensureDevServer: mocks.ensureDevServer,
}));

vi.mock('../browser/session.js', () => ({
  openBrowser: mocks.openBrowser,
  closeBrowser: mocks.closeBrowser,
}));

vi.mock('../browser/capture.js', () => ({
  startRecording: mocks.startRecording,
}));

vi.mock('../artifacts/bundle.js', () => ({
  ensureOutputDir: mocks.ensureOutputDir,
  generateTimestamp: mocks.generateTimestamp,
  generateSessionDirName: mocks.generateSessionDirName,
}));

vi.mock('../session/state.js', () => ({
  saveSession: mocks.saveSession,
  hasActiveSession: mocks.hasActiveSession,
  clearSession: mocks.clearSession,
  loadSession: mocks.loadSession,
  reserveOutputSession: mocks.reserveOutputSession,
  generateAgentBrowserSessionName: mocks.generateAgentBrowserSessionName,
}));

vi.mock('../session/registry.js', () => ({
  listRegisteredSessions: mocks.listRegisteredSessions,
  registerSession: mocks.registerSession,
  reserveSession: mocks.reserveSession,
  unregisterSession: mocks.unregisterSession,
}));

vi.mock('../session/lifecycle.js', () => ({
  discardSession: mocks.discardSession,
  isSessionStillStarting: mocks.isSessionStillStarting,
}));

vi.mock('../session/metadata.js', () => ({
  writeMetadata: mocks.writeMetadata,
}));

vi.mock('child_process', () => ({
  execSync: mocks.execSync,
}));

vi.mock('../utils/process.js', () => ({
  isProcessRunning: mocks.isProcessRunning,
  terminateProcessTree: mocks.terminateProcessTree,
}));

describe('startCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    mocks.loadConfig.mockReturnValue({
      output: './proofshot-artifacts',
      headless: true,
      viewport: { width: 1280, height: 720 },
      browser: {},
      devServer: {
        port: 3000,
        startupTimeout: 1000,
      },
    });
    mocks.hasActiveSession.mockReturnValue(false);
    mocks.loadSession.mockReturnValue(null);
    mocks.listRegisteredSessions.mockReturnValue([]);
    mocks.isSessionStillStarting.mockReturnValue(false);
    mocks.generateTimestamp.mockReturnValue('2026-04-08_07-28-00');
    mocks.generateSessionDirName.mockReturnValue('2026-04-08_07-28-00_test');
    mocks.generateAgentBrowserSessionName.mockReturnValue('proofshot-2026-04-08_07-28-00');
    mocks.execSync.mockImplementation((command: string) => {
      if (command === 'git branch --show-current') return 'main';
      if (command === 'git rev-parse HEAD') return 'deadbeef';
      throw new Error(`unexpected command: ${command}`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('closes the browser when recording never starts after all retries', async () => {
    mocks.startRecording.mockImplementation(() => {
      throw new Error('Recording session could not be initialized');
    });

    const commandPromise = startCommand({}).catch((error) => error);
    await vi.runAllTimersAsync();

    await expect(commandPromise).resolves.toMatchObject({ message: 'process.exit:1' });
    expect(mocks.startRecording).toHaveBeenCalledTimes(3);
    expect(mocks.closeBrowser).toHaveBeenCalledTimes(1);
    expect(mocks.saveSession).not.toHaveBeenCalled();
  });

  it('does not try to stop recording when recording never started', async () => {
    mocks.startRecording.mockImplementation(() => {
      throw new Error('Recording already active');
    });

    const commandPromise = startCommand({}).catch((error) => error);
    await vi.runAllTimersAsync();

    await expect(commandPromise).resolves.toMatchObject({ message: 'process.exit:1' });
    expect(mocks.startRecording).toHaveBeenCalledTimes(3);
    expect(mocks.closeBrowser).toHaveBeenCalledTimes(1);
  });

  it('closes the session-scoped browser when browser open fails', async () => {
    mocks.openBrowser.mockImplementation(() => {
      throw new Error('Chrome exited early without writing DevToolsActivePort');
    });

    const commandPromise = startCommand({}).catch((error) => error);

    await expect(commandPromise).resolves.toMatchObject({ message: 'process.exit:1' });
    expect(mocks.closeBrowser).toHaveBeenCalledTimes(1);
    expect(mocks.startRecording).not.toHaveBeenCalled();
    expect(mocks.saveSession).not.toHaveBeenCalled();
  });

  it('persists the same session in artifact and global state', async () => {
    await startCommand({});

    expect(mocks.saveSession).toHaveBeenCalledTimes(1);
    expect(mocks.registerSession).toHaveBeenCalledWith(
      mocks.saveSession.mock.calls[0][0],
    );
    expect(mocks.saveSession.mock.calls[0][0]).toMatchObject({
      startDirectory: process.cwd(),
      browserConfigPath: null,
      headless: true,
    });
  });

  it('records owned-server identity before waiting for startup readiness', async () => {
    const server = {
      alreadyRunning: false,
      port: 3000,
      pid: 1234,
      ownershipToken: 'ownership-token',
      processStartTime: 'start-time',
    };
    mocks.ensureDevServer.mockImplementation(
      async (
        _command: string,
        _port: number,
        _timeout: number,
        _logPath: string,
        onSpawn: (state: typeof server) => void,
      ) => {
        onSpawn(server);
        return server;
      },
    );

    await startCommand({ run: 'npm run dev' });

    expect(mocks.registerSession).toHaveBeenCalledWith(
      expect.objectContaining({
        serverPid: 1234,
        serverOwnershipToken: 'ownership-token',
        serverProcessStartTime: 'start-time',
      }),
    );
  });

  it('cleans up live resources when registry persistence fails', async () => {
    mocks.registerSession.mockImplementation(() => {
      throw new Error('state directory is read-only');
    });

    await expect(startCommand({})).rejects.toMatchObject({ message: 'process.exit:1' });

    expect(mocks.discardSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionName: expect.stringContaining('proofshot-') }),
    );
  });

  it('does not clear another session when output reservation fails', async () => {
    mocks.reserveOutputSession.mockImplementation(() => {
      throw Object.assign(new Error('already reserved'), { code: 'EEXIST' });
    });

    await startCommand({});

    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.reserveSession).toHaveBeenCalled();
    expect(mocks.openBrowser).not.toHaveBeenCalled();
  });

  it('propagates non-contention output reservation errors', async () => {
    mocks.reserveOutputSession.mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });

    await expect(startCommand({})).rejects.toThrow('permission denied');

    expect(mocks.unregisterSession).toHaveBeenCalled();
    expect(mocks.openBrowser).not.toHaveBeenCalled();
  });
});
