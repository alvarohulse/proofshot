import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSafeAgentBrowserRecordingPlatform,
  prepareQuietFfmpegWrapper,
} from './ffmpeg-wrapper.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('quiet FFmpeg wrapper', () => {
  it('refuses Windows recording instead of silently using the deadlock-prone path', () => {
    expect(() => assertSafeAgentBrowserRecordingPlatform('win32')).toThrow(
      /temporarily unsupported on Windows.*deadlock/i,
    );
    expect(() => assertSafeAgentBrowserRecordingPlatform('linux')).not.toThrow();
    expect(() => assertSafeAgentBrowserRecordingPlatform('darwin')).not.toThrow();
  });

  it('suppresses progress output before forwarding recorder arguments', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-ffmpeg-wrapper-'));
    temporaryDirectories.push(root);
    const fakeFfmpeg = path.join(root, 'ffmpeg executable');
    fs.writeFileSync(fakeFfmpeg, '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
      mode: 0o700,
    });

    const wrapperDirectory = prepareQuietFfmpegWrapper({
      ffmpegExecutable: fakeFfmpeg,
      platform: 'linux',
      stateRoot: path.join(root, 'state'),
    });

    expect(wrapperDirectory).not.toBeNull();
    const output = execFileSync(
      path.join(wrapperDirectory!, 'ffmpeg'),
      ['-y', 'session.mp4'],
      { encoding: 'utf-8' },
    );
    expect(output.trim().split('\n')).toEqual([
      '-nostats',
      '-loglevel',
      'error',
      '-y',
      'session.mp4',
    ]);
    expect(fs.statSync(path.join(wrapperDirectory!, 'ffmpeg')).mode & 0o777).toBe(
      0o700,
    );
  });
});
