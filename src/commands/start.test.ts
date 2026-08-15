import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCommand } from './start.js';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  ensureDevServer: vi.fn(),
  openBrowser: vi.fn(),
  getPageUrl: vi.fn(),
  closeBrowser: vi.fn(),
  startRecording: vi.fn(),
  preparePrivateNetworkEvidence: vi.fn(),
  startPrivateNetworkCapture: vi.fn(),
  ensureOutputDir: vi.fn(),
  generateTimestamp: vi.fn(),
  generateSessionDirName: vi.fn(),
  saveSession: vi.fn(),
  loadSession: vi.fn(),
  hasActiveSession: vi.fn(),
  clearSession: vi.fn(),
  generateAgentBrowserNamespace: vi.fn(),
  generateAgentBrowserSessionName: vi.fn(),
  resolveSessionControlDir: vi.fn(),
  writeMetadata: vi.fn(),
  discoverBrowserExecutable: vi.fn(),
  browserSetupError: vi.fn(),
  prepareAgentBrowserSocketDir: vi.fn(),
  resolveAgentBrowserRuntimeDir: vi.fn(),
  captureAgentBrowserProcessIdentity: vi.fn(),
  cleanupFailedStart: vi.fn(),
  startOwnedEnvironment: vi.fn(),
  registerSession: vi.fn(),
  unregisterSession: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('../utils/config.js', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../server/start.js', () => ({
  ensureDevServer: mocks.ensureDevServer,
}));

vi.mock('../browser/session.js', () => ({
  getPageUrl: mocks.getPageUrl,
  openBrowser: mocks.openBrowser,
  closeBrowser: mocks.closeBrowser,
}));

vi.mock('../browser/capture.js', () => ({
  startRecording: mocks.startRecording,
}));
vi.mock('../browser/evidence.js', () => ({
  preparePrivateNetworkEvidence: mocks.preparePrivateNetworkEvidence,
  startPrivateNetworkCapture: mocks.startPrivateNetworkCapture,
}));

vi.mock('../browser/discovery.js', () => ({
  discoverBrowserExecutable: mocks.discoverBrowserExecutable,
  browserSetupError: mocks.browserSetupError,
}));

vi.mock('../browser/runtime.js', () => ({
  prepareAgentBrowserSocketDir: mocks.prepareAgentBrowserSocketDir,
  resolveAgentBrowserRuntimeDir: mocks.resolveAgentBrowserRuntimeDir,
  captureAgentBrowserProcessIdentity: mocks.captureAgentBrowserProcessIdentity,
}));

vi.mock('../artifacts/bundle.js', () => ({
  ensureOutputDir: mocks.ensureOutputDir,
  generateTimestamp: mocks.generateTimestamp,
  generateSessionDirName: mocks.generateSessionDirName,
}));

vi.mock('../session/state.js', () => ({
  saveSession: mocks.saveSession,
  loadSession: mocks.loadSession,
  hasActiveSession: mocks.hasActiveSession,
  clearSession: mocks.clearSession,
  generateAgentBrowserNamespace: mocks.generateAgentBrowserNamespace,
  generateAgentBrowserSessionName: mocks.generateAgentBrowserSessionName,
  resolveSessionControlDir: mocks.resolveSessionControlDir,
}));

vi.mock('../session/lifecycle.js', () => ({
  cleanupFailedStart: mocks.cleanupFailedStart,
}));
vi.mock('../environment/runtime.js', () => ({
  startOwnedEnvironment: mocks.startOwnedEnvironment,
}));

vi.mock('../session/registry.js', () => ({
  registerSession: mocks.registerSession,
  unregisterSession: mocks.unregisterSession,
}));

vi.mock('../session/metadata.js', () => ({
  writeMetadata: mocks.writeMetadata,
}));

vi.mock('child_process', () => ({
  execSync: mocks.execSync,
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
    mocks.resolveSessionControlDir.mockReturnValue('/project/proofshot-artifacts');
    mocks.generateTimestamp.mockReturnValue('2026-04-08_07-28-00');
    mocks.generateSessionDirName.mockReturnValue('2026-04-08_07-28-00_test');
    mocks.generateAgentBrowserSessionName.mockReturnValue('ps-2026-04-deadbeef1234');
    mocks.generateAgentBrowserNamespace.mockReturnValue('psn-deadbeef1234');
    mocks.prepareAgentBrowserSocketDir.mockReturnValue('/run/user/1000/proofshot');
    mocks.resolveAgentBrowserRuntimeDir.mockReturnValue(
      '/run/user/1000/proofshot/namespaces/psn-deadbeef1234/run',
    );
    mocks.discoverBrowserExecutable.mockReturnValue('/usr/bin/chromium');
    mocks.getPageUrl.mockReturnValue('');
    mocks.captureAgentBrowserProcessIdentity.mockReturnValue({
      pid: 4001,
      processGroupId: 4001,
      sessionId: 4001,
      startTime: '12345',
    });
    mocks.cleanupFailedStart.mockResolvedValue(undefined);
    mocks.startOwnedEnvironment.mockResolvedValue(null);
    mocks.preparePrivateNetworkEvidence.mockReturnValue({
      privateDirectory: '/audit/private/agent-browser',
      harPath: '/audit/private/agent-browser/network.har',
      requestsPath: '/audit/private/agent-browser/requests.json',
      summaryPath: '/audit/network-summary.json',
    });
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

  it('cleans the owned session when recording never starts after all retries', async () => {
    mocks.startRecording.mockImplementation(() => {
      throw new Error('Recording session could not be initialized');
    });

    const commandPromise = startCommand({}).catch((error) => error);
    await vi.runAllTimersAsync();

    await expect(commandPromise).resolves.toMatchObject({ message: 'process.exit:1' });
    expect(mocks.startRecording).toHaveBeenCalledTimes(3);
    expect(mocks.cleanupFailedStart).toHaveBeenCalledTimes(1);
    expect(mocks.registerSession).toHaveBeenCalled();
    expect(mocks.unregisterSession).toHaveBeenCalledWith('ps-2026-04-deadbeef1234');
  });

  it('clears discoverable registry state when recording never starts', async () => {
    mocks.startRecording.mockImplementation(() => {
      throw new Error('Recording already active');
    });

    const commandPromise = startCommand({}).catch((error) => error);
    await vi.runAllTimersAsync();

    await expect(commandPromise).resolves.toMatchObject({ message: 'process.exit:1' });
    expect(mocks.startRecording).toHaveBeenCalledTimes(3);
    expect(mocks.cleanupFailedStart).toHaveBeenCalledTimes(1);
    expect(mocks.unregisterSession).toHaveBeenCalledWith('ps-2026-04-deadbeef1234');
  });

  it('closes the session-scoped browser when browser open fails', async () => {
    mocks.openBrowser.mockImplementation(() => {
      throw new Error('Chrome exited early without writing DevToolsActivePort');
    });

    const commandPromise = startCommand({}).catch((error) => error);

    await expect(commandPromise).resolves.toMatchObject({ message: 'process.exit:1' });
    expect(mocks.cleanupFailedStart).toHaveBeenCalledTimes(1);
    expect(mocks.startRecording).not.toHaveBeenCalled();
    expect(mocks.unregisterSession).toHaveBeenCalledWith('ps-2026-04-deadbeef1234');
  });

  it('persists the intended target and stable control path with custom evidence output', async () => {
    await startCommand({
      output: '/audit/custom-evidence',
      url: 'http://127.0.0.1:43171/getting-started',
    });

    expect(mocks.openBrowser).toHaveBeenCalledWith(
      'http://127.0.0.1:43171/getting-started',
      { width: 1280, height: 720 },
      true,
      'ps-2026-04-deadbeef1234',
      expect.objectContaining({ executablePath: '/usr/bin/chromium' }),
    );
    const finalState = mocks.registerSession.mock.calls.at(-1)?.[0];
    expect(finalState).toMatchObject({
      outputDir: '/audit/custom-evidence',
      targetUrl: 'http://127.0.0.1:43171/getting-started',
      recordingActive: true,
      lifecycleStatus: 'active',
      agentBrowserSocketDir:
        '/run/user/1000/proofshot/namespaces/psn-deadbeef1234/run',
      agentBrowserSocketRoot: '/run/user/1000/proofshot',
      agentBrowserNamespace: 'psn-deadbeef1234',
      agentBrowserAllowedDomains: ['127.0.0.1'],
    });
    expect(finalState.controlDir).toBe('/project/proofshot-artifacts');
  });

  it('persists server ownership before waiting for readiness', async () => {
    const serverProcess = {
      pid: 5001,
      processGroupId: 5001,
      sessionId: 5001,
      startTime: 'server-start',
    };
    mocks.ensureDevServer.mockImplementation(
      async (
        _command: string,
        _port: number,
        _timeout: number,
        _logPath: string,
        onStarted: (result: unknown) => void,
      ) => {
        onStarted({ alreadyRunning: false, port: 3000, process: serverProcess });
        throw new Error('readiness timed out');
      },
    );

    const commandPromise = startCommand({ run: 'npm run dev' }).catch((error) => error);
    await vi.runAllTimersAsync();
    await expect(commandPromise).resolves.toMatchObject({ message: 'process.exit:1' });

    expect(mocks.registerSession).toHaveBeenCalledWith(
      expect.objectContaining({ serverProcess }),
    );
    expect(mocks.cleanupFailedStart).toHaveBeenCalledWith(
      expect.objectContaining({ serverProcess }),
    );
  });

  it('retains recovery inventory when failed-start cleanup is incomplete', async () => {
    mocks.openBrowser.mockImplementation(() => {
      throw new Error('browser launch timed out');
    });
    mocks.cleanupFailedStart.mockRejectedValue(new Error('daemon identity unavailable'));

    const commandPromise = startCommand({}).catch((error) => error);
    await expect(commandPromise).resolves.toMatchObject({ message: 'process.exit:1' });

    expect(mocks.unregisterSession).not.toHaveBeenCalled();
    expect(mocks.registerSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lifecycleStatus: 'recovery',
        cleanupError: 'daemon identity unavailable',
      }),
    );
  });

  it('persists owned environment state before opening the browser', async () => {
    const environmentState = {
      kind: 'processes',
      evidencePath: '/audit/custom-evidence/run/environment.ndjson',
      sources: [],
      processes: [],
    };
    mocks.loadConfig.mockReturnValue({
      output: './proofshot-artifacts',
      headless: true,
      viewport: { width: 1280, height: 720 },
      browser: {},
      devServer: { port: 3000, startupTimeout: 1000 },
      environment: { kind: 'processes', commands: [] },
      logs: {},
    });
    mocks.startOwnedEnvironment.mockImplementation(
      async (
        _environment: unknown,
        _logs: unknown,
        _sessionDir: string,
        _sessionName: string,
        _startTime: number,
        onState: (state: unknown) => void,
      ) => {
        onState(environmentState);
        return environmentState;
      },
    );

    await startCommand({});

    expect(mocks.startOwnedEnvironment).toHaveBeenCalled();
    expect(mocks.startOwnedEnvironment.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openBrowser.mock.invocationCallOrder[0],
    );
    expect(mocks.registerSession).toHaveBeenCalledWith(
      expect.objectContaining({ environment: environmentState }),
    );
    expect(mocks.registerSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recordingStartedAt: expect.any(String),
        recordingActive: true,
      }),
    );
  });
});
