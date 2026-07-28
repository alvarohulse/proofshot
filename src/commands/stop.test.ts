import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  loadSession: vi.fn(),
  clearSession: vi.fn(),
  resolveSessionControlDir: vi.fn(),
  saveSession: vi.fn(),
  stopRecording: vi.fn(),
  getConsoleErrors: vi.fn(),
  getConsoleOutput: vi.fn(),
  getConsoleOutputJson: vi.fn(),
  stopOwnedBrowser: vi.fn(),
  stopOwnedServer: vi.fn(),
  canAddressOwnedBrowserSession: vi.fn(),
  writeViewer: vi.fn(),
  extractServerErrors: vi.fn(),
  loadSessionLog: vi.fn(),
  estimateTokenUsage: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('../utils/config.js', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('../session/state.js', () => ({
  loadSession: mocks.loadSession,
  clearSession: mocks.clearSession,
  resolveSessionControlDir: mocks.resolveSessionControlDir,
  saveSession: mocks.saveSession,
}));
vi.mock('../browser/capture.js', () => ({ stopRecording: mocks.stopRecording }));
vi.mock('../browser/session.js', () => ({
  getConsoleErrors: mocks.getConsoleErrors,
  getConsoleOutput: mocks.getConsoleOutput,
  getConsoleOutputJson: mocks.getConsoleOutputJson,
}));
vi.mock('../session/lifecycle.js', () => ({
  canAddressOwnedBrowserSession: mocks.canAddressOwnedBrowserSession,
  stopOwnedBrowser: mocks.stopOwnedBrowser,
  stopOwnedServer: mocks.stopOwnedServer,
}));
vi.mock('../artifacts/viewer.js', () => ({ writeViewer: mocks.writeViewer }));
vi.mock('../utils/error-patterns.js', () => ({ extractServerErrors: mocks.extractServerErrors }));
vi.mock('./exec.js', () => ({ loadSessionLog: mocks.loadSessionLog }));
vi.mock('../utils/token-usage.js', () => ({ estimateTokenUsage: mocks.estimateTokenUsage }));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execSync: mocks.execSync };
});

import { stopCommand } from './stop.js';

let root: string;
let session: any;

beforeEach(() => {
  const cache = path.join(os.userInfo().homedir, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  root = fs.mkdtempSync(path.join(cache, 'proofshot-stop-test-'));
  const sessionDir = path.join(root, 'custom-evidence', 'session');
  fs.mkdirSync(sessionDir, { recursive: true });
  session = {
    startedAt: new Date(Date.now() - 1000).toISOString(),
    description: 'retry bundle',
    outputDir: path.join(root, 'custom-evidence'),
    sessionDir,
    sessionName: 'ps-retry-deadbeef1234',
    videoPath: path.join(sessionDir, 'session.webm'),
    serverErrorLog: path.join(sessionDir, 'server.log'),
    port: 3000,
    serverCommand: 'npm run dev',
    serverAlreadyRunning: false,
    recordingActive: true,
    bundleComplete: false,
    browserRetained: false,
    videoTrimComplete: false,
    trimOffsetSec: 0,
    sessionLogAdjusted: false,
    consoleEvidenceAvailable: false,
    consoleErrorCount: 0,
    serverProcess: { pid: 1001, processGroupId: 1001, sessionId: 1001, startTime: '1' },
    browserProcess: { pid: 1002, processGroupId: 1002, sessionId: 1002, startTime: '2' },
  };
  fs.writeFileSync(session.serverErrorLog, `${Date.now()}\tserver ready\n`);

  mocks.loadConfig.mockReturnValue({ output: './proofshot-artifacts', browser: {} });
  mocks.resolveSessionControlDir.mockReturnValue(path.join(root, 'proofshot-artifacts'));
  mocks.loadSession.mockImplementation(() => session);
  mocks.getConsoleErrors.mockReturnValue('No errors');
  mocks.getConsoleOutput.mockReturnValue('console evidence');
  mocks.getConsoleOutputJson.mockReturnValue([]);
  mocks.extractServerErrors.mockReturnValue([]);
  mocks.loadSessionLog.mockReturnValue([]);
  mocks.estimateTokenUsage.mockReturnValue(null);
  mocks.execSync.mockReturnValue('');
  mocks.stopOwnedBrowser.mockResolvedValue(undefined);
  mocks.stopOwnedServer.mockResolvedValue(undefined);
  mocks.canAddressOwnedBrowserSession.mockReturnValue(true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.values(mocks).forEach((mock) => mock.mockReset());
  fs.rmSync(root, { recursive: true, force: true });
});

describe('stopCommand retryability', () => {
  it('keeps state after a bundle failure and retries without replacing a valid summary', async () => {
    fs.writeFileSync(session.videoPath, 'nonempty-original-video');
    const sessionLogPath = path.join(session.sessionDir, 'session-log.json');
    fs.writeFileSync(
      sessionLogPath,
      JSON.stringify([
        { action: 'open target', relativeTimeSec: 10, timestamp: session.startedAt },
        { action: 'screenshot proof.png', relativeTimeSec: 20, timestamp: session.startedAt },
      ]),
    );
    mocks.loadSessionLog.mockImplementation(() =>
      JSON.parse(fs.readFileSync(sessionLogPath, 'utf-8')),
    );
    let trimCalls = 0;
    mocks.execSync.mockImplementation((command: string) => {
      if (command === 'ffmpeg -version') return '';
      if (command.startsWith('ffmpeg -i ')) {
        trimCalls += 1;
        fs.writeFileSync(session.videoPath, `trimmed-video-${trimCalls}`);
        return '';
      }
      throw new Error(`unexpected command: ${command}`);
    });
    mocks.writeViewer.mockImplementationOnce(() => {
      throw new Error('simulated viewer write failure');
    });

    await expect(stopCommand({})).rejects.toThrow('simulated viewer write failure');
    expect(mocks.stopOwnedBrowser).toHaveBeenCalledWith(session);
    expect(mocks.stopOwnedServer).toHaveBeenCalledWith(session);
    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingActive: false,
        bundleComplete: false,
        videoTrimComplete: true,
        trimOffsetSec: 5,
        sessionLogAdjusted: true,
      }),
      path.join(root, 'proofshot-artifacts'),
    );
    expect(trimCalls).toBe(1);
    expect(fs.readFileSync(session.videoPath, 'utf-8')).toBe('trimmed-video-1');
    expect(JSON.parse(fs.readFileSync(sessionLogPath, 'utf-8')).map((entry: any) => entry.relativeTimeSec)).toEqual([5, 15]);

    const summaryPath = path.join(session.sessionDir, 'SUMMARY.md');
    const summaryBefore = fs.readFileSync(summaryPath, 'utf-8');
    const summaryMtimeBefore = fs.statSync(summaryPath).mtimeMs;
    mocks.writeViewer.mockReturnValue(path.join(session.sessionDir, 'viewer.html'));
    mocks.canAddressOwnedBrowserSession.mockReturnValue(false);

    await stopCommand({});

    expect(mocks.writeViewer).toHaveBeenCalledTimes(2);
    expect(trimCalls).toBe(1);
    expect(fs.readFileSync(session.videoPath, 'utf-8')).toBe('trimmed-video-1');
    expect(JSON.parse(fs.readFileSync(sessionLogPath, 'utf-8')).map((entry: any) => entry.relativeTimeSec)).toEqual([5, 15]);
    expect(mocks.writeViewer.mock.calls.at(-1)?.[1].entries.map((entry: any) => entry.relativeTimeSec)).toEqual([5, 15]);
    expect(mocks.writeViewer.mock.calls.at(-1)?.[1]).toMatchObject({
      consoleEvidenceAvailable: true,
      consoleErrorCount: 0,
      consoleOutput: 'console evidence',
    });
    expect(mocks.clearSession).toHaveBeenCalledWith(path.join(root, 'proofshot-artifacts'));
    expect(fs.readFileSync(summaryPath, 'utf-8')).toBe(summaryBefore);
    expect(fs.statSync(summaryPath).mtimeMs).toBe(summaryMtimeBefore);
  });

  it('skips every session-addressed browser command when identity is mismatched', async () => {
    mocks.canAddressOwnedBrowserSession.mockReturnValue(false);
    mocks.writeViewer.mockReturnValue(path.join(session.sessionDir, 'viewer.html'));

    await stopCommand({});

    expect(mocks.getConsoleErrors).not.toHaveBeenCalled();
    expect(mocks.getConsoleOutput).not.toHaveBeenCalled();
    expect(mocks.getConsoleOutputJson).not.toHaveBeenCalled();
    expect(mocks.stopRecording).not.toHaveBeenCalled();
    expect(mocks.stopOwnedBrowser).toHaveBeenCalledWith(session);
    expect(mocks.stopOwnedServer).toHaveBeenCalledWith(session);
    expect(mocks.clearSession).toHaveBeenCalled();
    expect(mocks.writeViewer).toHaveBeenCalledWith(
      session.sessionDir,
      expect.objectContaining({ consoleEvidenceAvailable: false }),
    );
    const summary = fs.readFileSync(path.join(session.sessionDir, 'SUMMARY.md'), 'utf-8');
    expect(summary).toContain('console evidence was unavailable');
    expect(summary).not.toContain('No console errors detected');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Browser ownership could not be verified'),
    );
  });

  it('does not claim a retained browser was closed when its identity mismatches', async () => {
    session.bundleComplete = true;
    session.browserRetained = true;
    session.recordingActive = false;
    mocks.canAddressOwnedBrowserSession.mockReturnValue(false);

    await stopCommand({});

    expect(mocks.stopOwnedBrowser).toHaveBeenCalledWith(session);
    expect(mocks.clearSession).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('skipped session-name close'),
    );
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining('Retained browser closed'),
    );
  });
});
