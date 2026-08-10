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
  loadSession: vi.fn(),
  hasActiveSession: vi.fn(),
  clearSession: vi.fn(),
  generateAgentBrowserSessionName: vi.fn(),
  writeMetadata: vi.fn(),
  execSync: vi.fn(),
  startOwnedEnvironment: vi.fn(),
  stopOwnedEnvironment: vi.fn(),
}));

vi.mock('../utils/config.js', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../server/start.js', () => ({
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
  loadSession: mocks.loadSession,
  hasActiveSession: mocks.hasActiveSession,
  clearSession: mocks.clearSession,
  generateAgentBrowserSessionName: mocks.generateAgentBrowserSessionName,
}));

vi.mock('../session/metadata.js', () => ({
  writeMetadata: mocks.writeMetadata,
}));

vi.mock('../environment/runtime.js', () => ({
  startOwnedEnvironment: mocks.startOwnedEnvironment,
  stopOwnedEnvironment: mocks.stopOwnedEnvironment,
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
      logs: { sources: [] },
      devServer: {
        port: 3000,
        startupTimeout: 1000,
      },
    });
    mocks.hasActiveSession.mockReturnValue(false);
    mocks.generateTimestamp.mockReturnValue('2026-04-08_07-28-00');
    mocks.generateSessionDirName.mockReturnValue('2026-04-08_07-28-00_test');
    mocks.generateAgentBrowserSessionName.mockReturnValue('proofshot-2026-04-08_07-28-00');
    mocks.execSync.mockImplementation((command: string) => {
      if (command === 'git branch --show-current') return 'main';
      if (command === 'git rev-parse HEAD') return 'deadbeef';
      throw new Error(`unexpected command: ${command}`);
    });
    mocks.stopOwnedEnvironment.mockResolvedValue(undefined);
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

  it('persists environment ownership before continuing browser startup', async () => {
    const environment = {
      kind: 'processes',
      evidencePath: '/tmp/environment.ndjson',
      sources: [],
      processes: [],
    };
    mocks.loadConfig.mockReturnValue({
      output: './proofshot-artifacts',
      headless: true,
      viewport: { width: 1280, height: 720 },
      browser: {},
      environment: {
        kind: 'processes',
        commands: [{ id: 'api', command: 'npm run api' }],
      },
      logs: { sources: [] },
      devServer: {
        port: 3000,
        startupTimeout: 1000,
      },
    });
    mocks.startOwnedEnvironment.mockImplementation(
      async (_config, _logs, _sessionDir, _sessionName, _startTime, onState) => {
        onState(environment);
        return environment;
      },
    );

    await startCommand({});

    expect(mocks.startOwnedEnvironment).toHaveBeenCalledTimes(1);
    expect(mocks.openBrowser).toHaveBeenCalledTimes(1);
    expect(mocks.saveSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        environment,
        recordingActive: true,
      }),
    );
  });

  it('refuses to override an active session whose environment cannot be stopped', async () => {
    const session = {
      outputDir: '/tmp/proofshot-force-override',
      environment: {
        kind: 'processes',
        evidencePath: '/tmp/proofshot-force-override/environment.ndjson',
        sources: [],
        processes: [],
      },
    };
    mocks.hasActiveSession.mockReturnValue(true);
    mocks.loadSession.mockReturnValue(session);
    mocks.stopOwnedEnvironment.mockRejectedValue(
      new AggregateError(
        [
          new Error('Log helper for api did not stop.'),
          new Error('Owned tmux server did not stop.'),
        ],
        'One or more tmux cleanup steps failed.',
      ),
    );

    await expect(startCommand({ force: true })).rejects.toThrow('process.exit:1');

    expect(mocks.stopOwnedEnvironment).toHaveBeenCalledWith(session.environment);
    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.saveSession).toHaveBeenCalledWith(session);
    expect(mocks.openBrowser).not.toHaveBeenCalled();

    const output = vi
      .mocked(console.error)
      .mock.calls.map((call) => call.join(' '))
      .join('\n');
    expect(output).toContain('Log helper for api did not stop.');
    expect(output).toContain('Owned tmux server did not stop.');
    expect(output.match(/One or more tmux cleanup steps failed\./g)).toHaveLength(1);
  });

  it('stops the recorded environment before clearing a forced session', async () => {
    const session = {
      outputDir: '/tmp/proofshot-force-override',
      environment: {
        kind: 'processes',
        evidencePath: '/tmp/proofshot-force-override/environment.ndjson',
        sources: [],
        processes: [],
      },
    };
    mocks.hasActiveSession.mockReturnValue(true);
    mocks.loadSession.mockReturnValue(session);

    await startCommand({ force: true });

    expect(mocks.stopOwnedEnvironment).toHaveBeenCalledTimes(1);
    expect(mocks.clearSession).toHaveBeenCalledTimes(1);
    expect(mocks.openBrowser).toHaveBeenCalledTimes(1);
  });

  it('retains environment recovery state when failed startup cannot clean it', async () => {
    const environment = {
      kind: 'processes',
      evidencePath: '/tmp/environment.ndjson',
      sources: [],
      processes: [],
    };
    mocks.loadConfig.mockReturnValue({
      output: './proofshot-artifacts',
      headless: true,
      viewport: { width: 1280, height: 720 },
      browser: {},
      environment: {
        kind: 'processes',
        commands: [{ id: 'api', command: 'npm run api' }],
      },
      logs: { sources: [] },
      devServer: {
        port: 3000,
        startupTimeout: 1000,
      },
    });
    mocks.startOwnedEnvironment.mockImplementation(
      async (_config, _logs, _sessionDir, _sessionName, _startTime, onState) => {
        onState(environment);
        throw new Error('readiness failed');
      },
    );
    mocks.stopOwnedEnvironment.mockRejectedValue(new Error('process still alive'));

    await expect(startCommand({})).rejects.toThrow('process.exit:1');

    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.saveSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ environment }),
    );
    expect(mocks.openBrowser).not.toHaveBeenCalled();
  });
});
