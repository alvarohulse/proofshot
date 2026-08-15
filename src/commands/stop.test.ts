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
  registerSession: vi.fn(),
  unregisterSession: vi.fn(),
  stopOwnedEnvironment: vi.fn(),
  writeViewer: vi.fn(),
  extractServerErrors: vi.fn(),
  loadSessionLog: vi.fn(),
  estimateTokenUsage: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('../utils/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/config.js')>()),
  loadConfig: mocks.loadConfig,
}));
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
vi.mock('../session/registry.js', () => ({
  registerSession: mocks.registerSession,
  unregisterSession: mocks.unregisterSession,
}));
vi.mock('../session/selection.js', () => ({
  resolveLiveSession: mocks.loadSession,
}));
vi.mock('../environment/runtime.js', () => ({
  stopOwnedEnvironment: mocks.stopOwnedEnvironment,
}));
vi.mock('../artifacts/viewer.js', () => ({ writeViewer: mocks.writeViewer }));
vi.mock('../utils/error-patterns.js', () => ({ extractServerErrors: mocks.extractServerErrors }));
vi.mock('../session/action-log.js', () => ({
  loadSessionLog: mocks.loadSessionLog,
}));
vi.mock('../utils/token-usage.js', () => ({ estimateTokenUsage: mocks.estimateTokenUsage }));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFileSync: mocks.execFileSync };
});

import {
  convertVideoToMp4,
  generateProofSummary,
  stopCommand,
  trimVideo,
  type SummaryData,
} from './stop.js';

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
    startDirectory: path.join(root, 'project'),
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
    headless: false,
    viewport: { width: 2560, height: 1440 },
    serverProcess: { pid: 1001, processGroupId: 1001, sessionId: 1001, startTime: '1' },
    browserProcess: { pid: 1002, processGroupId: 1002, sessionId: 1002, startTime: '2' },
  };
  fs.writeFileSync(session.serverErrorLog, `${Date.now()}\tserver ready\n`);

  mocks.loadConfig.mockReturnValue({
    output: './proofshot-artifacts',
    browser: {},
    headless: true,
    viewport: { width: 1280, height: 720 },
  });
  mocks.resolveSessionControlDir.mockReturnValue(path.join(root, 'proofshot-artifacts'));
  mocks.loadSession.mockImplementation(() => session);
  mocks.getConsoleErrors.mockReturnValue('No errors');
  mocks.getConsoleOutput.mockReturnValue('console evidence');
  mocks.getConsoleOutputJson.mockReturnValue([]);
  mocks.extractServerErrors.mockReturnValue([]);
  mocks.loadSessionLog.mockReturnValue([]);
  mocks.estimateTokenUsage.mockReturnValue(null);
  mocks.execFileSync.mockReturnValue('');
  mocks.stopOwnedBrowser.mockResolvedValue(undefined);
  mocks.stopOwnedServer.mockResolvedValue(undefined);
  mocks.stopOwnedEnvironment.mockResolvedValue(undefined);
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
    let conversionCalls = 0;
    mocks.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'ffmpeg' && args[0] === '-version') return '';
      if (command === 'ffmpeg' && args.includes('-abort_on')) {
        const outputPath = args.at(-1);
        if (outputPath?.endsWith('.webm')) {
          trimCalls += 1;
          fs.writeFileSync(outputPath, `trimmed-video-${trimCalls}`);
        } else if (outputPath?.endsWith('.mp4')) {
          conversionCalls += 1;
          fs.writeFileSync(outputPath, `converted-video-${conversionCalls}`);
        }
        return '';
      }
      if (command === 'ffmpeg' && args[0] === '-v') return '';
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    });
    mocks.writeViewer.mockImplementationOnce(() => {
      throw new Error('simulated viewer write failure');
    });

    await expect(stopCommand({})).rejects.toThrow('simulated viewer write failure');
    expect(mocks.stopOwnedBrowser).toHaveBeenCalledWith(session);
    expect(mocks.stopOwnedServer).toHaveBeenCalledWith(session);
    expect(mocks.unregisterSession).not.toHaveBeenCalled();
    expect(mocks.registerSession).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingActive: false,
        bundleComplete: false,
        videoTrimComplete: true,
        trimOffsetSec: 5,
        sessionLogAdjusted: true,
        videoPath: path.join(session.sessionDir, 'session.mp4'),
      }),
    );
    expect(trimCalls).toBe(1);
    expect(conversionCalls).toBe(1);
    expect(fs.readFileSync(session.videoPath, 'utf-8')).toBe('converted-video-1');
    expect(fs.existsSync(path.join(session.sessionDir, 'session.webm'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(sessionLogPath, 'utf-8')).map((entry: any) => entry.relativeTimeSec)).toEqual([5, 15]);

    const summaryPath = path.join(session.sessionDir, 'SUMMARY.md');
    const summaryBefore = fs.readFileSync(summaryPath, 'utf-8');
    const summaryMtimeBefore = fs.statSync(summaryPath).mtimeMs;
    mocks.writeViewer.mockReturnValue(path.join(session.sessionDir, 'viewer.html'));
    mocks.canAddressOwnedBrowserSession.mockReturnValue(false);

    await stopCommand({});

    expect(mocks.writeViewer).toHaveBeenCalledTimes(2);
    expect(trimCalls).toBe(1);
    expect(conversionCalls).toBe(1);
    expect(fs.readFileSync(session.videoPath, 'utf-8')).toBe('converted-video-1');
    expect(JSON.parse(fs.readFileSync(sessionLogPath, 'utf-8')).map((entry: any) => entry.relativeTimeSec)).toEqual([5, 15]);
    expect(mocks.writeViewer.mock.calls.at(-1)?.[1].entries.map((entry: any) => entry.relativeTimeSec)).toEqual([5, 15]);
    expect(mocks.writeViewer.mock.calls.at(-1)?.[1]).toMatchObject({
      consoleEvidenceAvailable: true,
      consoleErrorCount: 0,
      consoleOutput: 'console evidence',
      viewport: session.viewport,
    });
    expect(mocks.unregisterSession).toHaveBeenCalledWith(session.sessionName);
    expect(fs.readFileSync(summaryPath, 'utf-8')).toBe(summaryBefore);
    expect(fs.statSync(summaryPath).mtimeMs).toBe(summaryMtimeBefore);
  });

  it('persists collected console evidence before cleanup failure and reuses it', async () => {
    mocks.getConsoleErrors.mockReturnValue('synthetic console failure');
    mocks.getConsoleOutput.mockReturnValue('captured before cleanup');
    mocks.getConsoleOutputJson.mockReturnValue([
      { type: 'error', text: 'synthetic console failure', timestamp: Date.now() },
    ]);
    mocks.stopOwnedServer.mockRejectedValueOnce(new Error('simulated server cleanup failure'));

    await expect(stopCommand({})).rejects.toThrow('simulated server cleanup failure');

    expect(session).toMatchObject({
      recordingActive: false,
      consoleEvidenceAvailable: true,
      consoleErrorCount: 1,
    });
    expect(fs.readFileSync(path.join(session.sessionDir, 'console-errors.log'), 'utf-8')).toBe(
      'synthetic console failure',
    );
    expect(fs.readFileSync(path.join(session.sessionDir, 'console-output.log'), 'utf-8')).toBe(
      'captured before cleanup',
    );

    mocks.canAddressOwnedBrowserSession.mockReturnValue(false);
    mocks.stopOwnedServer.mockResolvedValue(undefined);
    mocks.writeViewer.mockReturnValue(path.join(session.sessionDir, 'viewer.html'));
    await stopCommand({});

    expect(mocks.writeViewer).toHaveBeenCalledWith(
      session.sessionDir,
      expect.objectContaining({
        consoleEvidenceAvailable: true,
        consoleErrorCount: 1,
        consoleOutput: 'captured before cleanup',
        consoleEntries: [
          expect.objectContaining({ text: '[error] synthetic console failure' }),
        ],
      }),
    );
    const summary = fs.readFileSync(path.join(session.sessionDir, 'SUMMARY.md'), 'utf-8');
    expect(summary).toContain('1 error(s) detected');
    expect(summary).toContain('synthetic console failure');
  });

  it('withholds viewer dimensions when the session recorded no usable viewport', async () => {
    session.viewport = { width: 0, height: 720 };
    mocks.canAddressOwnedBrowserSession.mockReturnValue(false);
    mocks.writeViewer.mockReturnValue(path.join(session.sessionDir, 'viewer.html'));

    await stopCommand({});

    expect(mocks.writeViewer.mock.calls.at(-1)?.[1].viewport).toBeUndefined();
    expect(fs.readFileSync(path.join(session.sessionDir, 'SUMMARY.md'), 'utf-8')).toContain(
      '- Viewport: 1280x720',
    );
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
    expect(mocks.unregisterSession).toHaveBeenCalledWith(session.sessionName);
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
    expect(mocks.unregisterSession).toHaveBeenCalledWith(session.sessionName);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('skipped session-name close'),
    );
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining('Retained browser closed'),
    );
  });

  it('retains environment ownership when exact stop fails', async () => {
    session.environment = {
      kind: 'processes',
      evidencePath: path.join(session.sessionDir, 'environment.ndjson'),
      sources: [],
      processes: [],
    };
    mocks.stopOwnedEnvironment.mockRejectedValue(new Error('environment identity mismatch'));

    await expect(stopCommand({})).rejects.toThrow('environment identity mismatch');

    expect(session).toMatchObject({
      lifecycleStatus: 'recovery',
      cleanupError: 'Cleanup failed: environment identity mismatch',
    });
    expect(mocks.unregisterSession).not.toHaveBeenCalled();
  });
});

describe('stop artifacts', () => {
  it('reports the recorded viewport and browser mode', () => {
    const summary = generateProofSummary(buildSummaryData());

    expect(summary).toContain('**Project:** project');
    expect(summary).toContain('[session.mp4](./session.mp4)');
    expect(summary).toContain('- Browser: Chromium (headed)');
    expect(summary).toContain('- Viewport: 2560x1440');
  });

  it('converts the finalized WebM recording to H.264 MP4', () => {
    const videoPath = path.join(root, 'session.webm');
    const mp4Path = path.join(root, 'session.mp4');
    fs.writeFileSync(videoPath, 'webm-video');
    let conversionArgs: string[] = [];

    mocks.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === '-version' || args[0] === '-v') {
        return '';
      }
      conversionArgs = args;
      fs.writeFileSync(args.at(-1)!, 'mp4-video');
      return '';
    });

    expect(convertVideoToMp4(videoPath)).toBe(mp4Path);
    expect(conversionArgs).toEqual(
      expect.arrayContaining([
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
      ]),
    );
    expect(fs.readFileSync(mp4Path, 'utf-8')).toBe('mp4-video');
    expect(fs.existsSync(videoPath)).toBe(false);
  });

  it('keeps the WebM recording when MP4 conversion fails', () => {
    const videoPath = path.join(root, 'session.webm');
    fs.writeFileSync(videoPath, 'webm-video');

    mocks.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === '-version') {
        return '';
      }
      fs.writeFileSync(args.at(-1)!, 'partial-mp4');
      throw new Error('conversion failed');
    });

    expect(convertVideoToMp4(videoPath)).toBe(videoPath);
    expect(fs.readFileSync(videoPath, 'utf-8')).toBe('webm-video');
    expect(fs.existsSync(path.join(root, 'session.mp4'))).toBe(false);
    expect(
      fs.readdirSync(root).some((entry) => entry.endsWith('.tmp.mp4')),
    ).toBe(false);
  });

  it('adopts a completed MP4 left by interrupted finalization', () => {
    const videoPath = path.join(root, 'session.webm');
    const mp4Path = path.join(root, 'session.mp4');
    fs.writeFileSync(videoPath, 'webm-video');
    fs.writeFileSync(mp4Path, 'completed-mp4');

    expect(convertVideoToMp4(videoPath)).toBe(mp4Path);
    expect(fs.existsSync(videoPath)).toBe(false);
    expect(fs.readFileSync(mp4Path, 'utf-8')).toBe('completed-mp4');
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it('restores the original video when trimming leaves partial output', () => {
    const videoPath = path.join(root, 'session.webm');
    fs.writeFileSync(videoPath, 'original-video');
    let trimArgs: string[] = [];

    mocks.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (_command === 'ffprobe') {
        return JSON.stringify({
          format: { start_time: '0', duration: '30' },
        });
      }
      if (args[0] === '-version') {
        return '';
      }
      trimArgs = args;
      fs.writeFileSync(videoPath, 'partial-video');
      throw new Error('empty output');
    });

    const trimOffset = trimVideo(
      videoPath,
      [],
      root,
      0,
      [
        { action: 'open', relativeTimeSec: 10, timestamp: '2026-07-16T18:00:10.000Z' },
        { action: 'click', relativeTimeSec: 20, timestamp: '2026-07-16T18:00:20.000Z' },
      ],
    );

    expect(trimOffset).toBe(0);
    expect(trimArgs).toContain('-abort_on');
    expect(fs.readFileSync(videoPath, 'utf-8')).toBe('original-video');
    expect(fs.existsSync(path.join(root, 'session-raw.webm'))).toBe(false);
  });

  it('restores the original video when FFmpeg exits successfully with empty output', () => {
    const videoPath = path.join(root, 'session.webm');
    fs.writeFileSync(videoPath, 'original-video');

    mocks.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (_command === 'ffprobe') {
        return JSON.stringify({
          format: { start_time: '0', duration: '30' },
        });
      }
      if (args[0] === '-version') {
        return '';
      }
      fs.writeFileSync(videoPath, '');
      return '';
    });

    const trimOffset = trimVideo(
      videoPath,
      [],
      root,
      0,
      [
        { action: 'open', relativeTimeSec: 10, timestamp: '2026-07-16T18:00:10.000Z' },
        { action: 'click', relativeTimeSec: 20, timestamp: '2026-07-16T18:00:20.000Z' },
      ],
    );

    expect(trimOffset).toBe(0);
    expect(fs.readFileSync(videoPath, 'utf-8')).toBe('original-video');
  });

  it('converts session-relative actions to the recording timeline before trimming', () => {
    const videoPath = path.join(root, 'session.webm');
    fs.writeFileSync(videoPath, 'original-video');
    let trimArgs: string[] = [];

    mocks.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (_command === 'ffprobe') {
        return JSON.stringify({
          format: { start_time: '0', duration: '20' },
        });
      }
      if (args[0] === '-version') {
        return '';
      }
      if (args[0] === '-v') {
        return '';
      }
      trimArgs = args;
      fs.writeFileSync(videoPath, 'trimmed-video');
      return '';
    });

    trimVideo(
      videoPath,
      [],
      root,
      0,
      [
        { action: 'open', relativeTimeSec: 83, timestamp: '2026-07-16T18:01:23.000Z' },
        { action: 'click', relativeTimeSec: 93, timestamp: '2026-07-16T18:01:33.000Z' },
      ],
      83,
    );

    const seekIndex = trimArgs.indexOf('-ss');
    expect(trimArgs[seekIndex + 1]).toBe('0.00');
    expect(fs.readFileSync(videoPath, 'utf-8')).toBe('trimmed-video');
  });
});

function buildSummaryData(): SummaryData {
  return {
    projectDirectory: path.join(root, 'project'),
    description: 'artifact verification',
    serverCommand: 'npm run dev',
    port: 4173,
    headless: false,
    viewport: { width: 2560, height: 1440 },
    videoPath: path.join(root, 'session.mp4'),
    screenshots: [],
    consoleErrors: '',
    consoleErrorCount: 0,
    consoleEvidenceAvailable: true,
    serverLog: '',
    serverErrorCount: 0,
    tokenUsage: null,
    durationSec: 30,
    outputDir: root,
  };
}
