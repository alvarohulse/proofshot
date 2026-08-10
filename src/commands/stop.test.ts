import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stopCommand } from './stop.js';
import type { SessionState } from '../session/state.js';

const mocks = vi.hoisted(() => ({
  loadConfigForTeardown: vi.fn(),
  loadSession: vi.fn(),
  clearSession: vi.fn(),
  saveSession: vi.fn(),
  getConsoleErrors: vi.fn(),
  getConsoleOutput: vi.fn(),
  getConsoleOutputJson: vi.fn(),
  stopOwnedEnvironment: vi.fn(),
}));

vi.mock('../utils/config.js', () => ({
  loadConfigForTeardown: mocks.loadConfigForTeardown,
}));

vi.mock('../session/state.js', () => ({
  loadSession: mocks.loadSession,
  clearSession: mocks.clearSession,
  saveSession: mocks.saveSession,
}));

vi.mock('../browser/session.js', () => ({
  closeBrowser: vi.fn(),
  getConsoleErrors: mocks.getConsoleErrors,
  getConsoleOutput: mocks.getConsoleOutput,
  getConsoleOutputJson: mocks.getConsoleOutputJson,
}));

vi.mock('../browser/capture.js', () => ({
  stopRecording: vi.fn(),
}));

vi.mock('../environment/runtime.js', () => ({
  stopOwnedEnvironment: mocks.stopOwnedEnvironment,
}));

describe('stopCommand environment cleanup', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    mocks.loadConfigForTeardown.mockReturnValue({
      config: {
        output: '/tmp/proofshot-environment-stop',
        browser: {},
      },
      error: null,
    });
    mocks.getConsoleErrors.mockReturnValue('');
    mocks.getConsoleOutput.mockReturnValue('');
    mocks.getConsoleOutputJson.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('retains session state when owned environment cleanup fails', async () => {
    const session: SessionState = {
      startedAt: new Date().toISOString(),
      description: null,
      outputDir: '/tmp/proofshot-environment-stop',
      sessionDir: '/tmp/proofshot-environment-stop/session',
      sessionName: 'proofshot-test',
      videoPath: '/tmp/proofshot-environment-stop/session/session.webm',
      serverErrorLog: '/tmp/proofshot-environment-stop/session/server.log',
      port: 3000,
      serverCommand: null,
      serverAlreadyRunning: true,
      recordingActive: false,
      environment: {
        kind: 'processes',
        evidencePath: '/tmp/proofshot-environment-stop/session/environment.ndjson',
        sources: [],
        processes: [],
      },
    };
    mocks.loadSession.mockReturnValue(session);
    mocks.stopOwnedEnvironment.mockRejectedValue(
      new AggregateError(
        [new Error('Environment process api did not stop.')],
        'One or more environment processes did not stop.',
      ),
    );

    await expect(stopCommand({})).rejects.toThrow('process.exit:1');

    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.saveSession).toHaveBeenCalledWith(session);
    expect(session.environment).not.toBeNull();
    expect(
      vi
        .mocked(console.error)
        .mock.calls.map((call) => call.join(' '))
        .join('\n'),
    ).toContain('Environment process api did not stop.');
  });
});
