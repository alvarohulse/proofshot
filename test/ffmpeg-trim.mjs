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
      'color=c=blue:s=64x64:r=1:d=20',
      '-c:v',
      'libvpx-vp9',
      '-g',
      '1',
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
      { action: 'open', relativeTimeSec: 6, timestamp },
      { action: 'screenshot', relativeTimeSec: 12, timestamp },
    ],
  );

  if (trimOffset !== 1) {
    throw new Error(`Expected a 1-second trim offset, received ${trimOffset}.`);
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
