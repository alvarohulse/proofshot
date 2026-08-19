import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ab: vi.fn() }));
vi.mock('../utils/exec.js', () => ({ ab: mocks.ab }));

import { finalizeRecording, stopRecording } from './capture.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
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
});
