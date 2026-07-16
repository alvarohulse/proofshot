import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateProofSummary,
  trimVideo,
  type SummaryData,
} from './stop.js';

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mocks.execSync,
}));

describe('stop artifacts', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-stop-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    vi.restoreAllMocks();
    mocks.execSync.mockReset();
  });

  it('reports the session viewport and browser mode', () => {
    const summary = generateProofSummary(buildSummaryData());

    expect(summary).toContain('**Project:** project');
    expect(summary).toContain('- Browser: Chromium (headed)');
    expect(summary).toContain('- Viewport: 2560x1440');
  });

  it('restores the original video when trimming leaves partial output', () => {
    const videoPath = path.join(temporaryDirectory, 'session.webm');
    fs.writeFileSync(videoPath, 'original-video');
    let trimCommand = '';

    mocks.execSync.mockImplementation((command: string) => {
      if (command === 'ffmpeg -version') {
        return '';
      }

      trimCommand = command;
      fs.writeFileSync(videoPath, 'partial-video');
      throw new Error('empty output');
    });

    const trimOffset = trimVideo(
      videoPath,
      [],
      temporaryDirectory,
      0,
      [
        { action: 'open', relativeTimeSec: 10, timestamp: '2026-07-16T18:00:10.000Z' },
        { action: 'click', relativeTimeSec: 20, timestamp: '2026-07-16T18:00:20.000Z' },
      ],
    );

    expect(trimOffset).toBe(0);
    expect(trimCommand).toContain('-abort_on empty_output');
    expect(fs.readFileSync(videoPath, 'utf-8')).toBe('original-video');
    expect(fs.existsSync(path.join(temporaryDirectory, 'session-raw.webm'))).toBe(false);
  });

  it('restores the original video when FFmpeg exits successfully with empty output', () => {
    const videoPath = path.join(temporaryDirectory, 'session.webm');
    fs.writeFileSync(videoPath, 'original-video');

    mocks.execSync.mockImplementation((command: string) => {
      if (command === 'ffmpeg -version') {
        return '';
      }

      fs.writeFileSync(videoPath, '');
      return '';
    });

    const trimOffset = trimVideo(
      videoPath,
      [],
      temporaryDirectory,
      0,
      [
        { action: 'open', relativeTimeSec: 10, timestamp: '2026-07-16T18:00:10.000Z' },
        { action: 'click', relativeTimeSec: 20, timestamp: '2026-07-16T18:00:20.000Z' },
      ],
    );

    expect(trimOffset).toBe(0);
    expect(fs.readFileSync(videoPath, 'utf-8')).toBe('original-video');
  });

  function buildSummaryData(): SummaryData {
    return {
      projectDirectory: '/work/project',
      description: 'High-resolution verification',
      serverCommand: 'npm run dev',
      port: 3000,
      headless: false,
      viewport: { width: 2560, height: 1440 },
      videoPath: '/work/project/proofshot-artifacts/session.webm',
      screenshots: ['step.png'],
      consoleErrors: '',
      consoleErrorCount: 0,
      serverLog: '',
      serverErrorCount: 0,
      tokenUsage: null,
      durationSec: 20,
      outputDir: '/work/project/proofshot-artifacts',
    };
  }
});
