import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { trimVideo } from '../dist/src/index.js';

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'proofshot-ffmpeg-'),
);
const videoPath = path.join(temporaryDirectory, 'session.webm');

try {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=64x64:r=1:d=13',
      '-c:v',
      'libvpx-vp9',
      '-g',
      '10',
      videoPath,
    ],
    { stdio: 'pipe', timeout: 60_000 },
  );
  const timestamp = new Date().toISOString();
  const trimOffset = trimVideo(
    videoPath,
    [],
    temporaryDirectory,
    Date.now(),
    [
      { action: 'open', relativeTimeSec: 12, timestamp },
      { action: 'screenshot', relativeTimeSec: 18, timestamp },
    ],
  );

  if (trimOffset !== 7) {
    throw new Error(`Expected a 7-second timeline offset, received ${trimOffset}.`);
  }
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=start_time,duration',
        '-of',
        'json',
        videoPath,
      ],
      { encoding: 'utf-8', timeout: 60_000 },
    ).trim(),
  );
  const startTime = Number(probe.format?.start_time);
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(startTime) || startTime > 0.1) {
    throw new Error(`Trimmed media starts at ${startTime}s instead of zero.`);
  }
  if (duration - startTime < 10.5) {
    throw new Error(
      `Trimmed media ended before the canonical 11-second action timeline: ${
        duration - startTime
      }s.`,
    );
  }
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      videoPath,
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-f',
      'null',
      '-',
    ],
    { stdio: 'pipe', timeout: 60_000 },
  );
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
