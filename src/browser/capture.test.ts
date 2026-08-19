import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ab: vi.fn() }));
vi.mock('../utils/exec.js', () => ({ ab: mocks.ab }));
vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => Buffer.from('video')),
}));

import {
  finalizeRecording,
  stopRecording,
} from './capture.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  mocks.ab.mockReset();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('recording finalization', () => {
  it('allows a bounded long flush and verifies stable non-empty media', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-capture-'));
    temporaryDirectories.push(directory);
    const videoPath = path.join(directory, 'session.mp4');
    mocks.ab.mockImplementation(() => {
      fs.writeFileSync(videoPath, 'video');
      return '';
    });

    await expect(finalizeRecording(videoPath, 'ps-session')).resolves.toBeUndefined();
    expect(mocks.ab).toHaveBeenCalledWith(['record', 'stop'], {
      timeoutMs: 120_000,
      session: 'ps-session',
    });
  });

  it('accepts an already-finished recorder for retryable stop', () => {
    mocks.ab.mockImplementation(() => {
      throw new Error('No recording in progress');
    });

    expect(() => stopRecording('ps-session')).not.toThrow();
  });

  it('propagates all other recorder failures', () => {
    mocks.ab.mockImplementation(() => {
      throw new Error('recorder flush failed');
    });

    expect(() => stopRecording('ps-session')).toThrow('recorder flush failed');
  });

  it.each([
    ['missing', false],
    ['empty', true],
  ])(
    'retains recovery ownership when finalized media is %s',
    async (_label, createEmptyFile) => {
      vi.useFakeTimers();
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'proofshot-capture-'),
      );
      temporaryDirectories.push(directory);
      const videoPath = path.join(directory, 'session.mp4');
      if (createEmptyFile) fs.writeFileSync(videoPath, '');
      mocks.ab.mockReturnValue('');

      const rejection = expect(
        finalizeRecording(videoPath, 'ps-session'),
      ).rejects.toThrow(
        'Recording finalization did not produce a stable non-empty file',
      );
      await vi.advanceTimersByTimeAsync(5_100);

      await rejection;
    },
  );

  it('extends the quiet deadline while finalized media is still growing', async () => {
    vi.useFakeTimers();
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-capture-'),
    );
    temporaryDirectories.push(directory);
    const videoPath = path.join(directory, 'session.mp4');
    fs.writeFileSync(videoPath, 'video');
    mocks.ab.mockReturnValue('');
    const growth = setInterval(() => fs.appendFileSync(videoPath, 'x'), 50);

    const finalization = expect(
      finalizeRecording(videoPath, 'ps-session'),
    ).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_100);
    clearInterval(growth);
    await vi.advanceTimersByTimeAsync(300);

    await finalization;
  });
});
