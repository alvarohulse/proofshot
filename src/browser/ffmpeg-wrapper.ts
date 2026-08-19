import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findExecutablePath } from '../utils/process.js';

type QuietFfmpegWrapperOptions = {
  ffmpegExecutable?: string;
  platform?: NodeJS.Platform;
  stateRoot?: string;
};

export function assertSafeAgentBrowserRecordingPlatform(
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') return;

  throw new Error(
    'ProofShot recording is temporarily unsupported on Windows because agent-browser 0.34.0 can deadlock while finalizing FFmpeg output. Use Linux or macOS until the upstream recorder drains FFmpeg stderr.',
  );
}

export function prepareQuietFfmpegWrapper(
  options: QuietFfmpegWrapperOptions = {},
): string | null {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') return null;

  const discoveredFfmpeg =
    options.ffmpegExecutable ?? findExecutablePath('ffmpeg', platform);
  if (!discoveredFfmpeg) return null;

  const ffmpegExecutable = fs.realpathSync(discoveredFfmpeg);
  const executableStat = fs.statSync(ffmpegExecutable);
  if (!executableStat.isFile()) {
    throw new Error(`FFmpeg executable is not a regular file: ${ffmpegExecutable}`);
  }
  fs.accessSync(ffmpegExecutable, fs.constants.R_OK | fs.constants.X_OK);

  const stateRoot =
    options.stateRoot ??
    path.join(os.homedir(), '.local', 'state', 'proofshot');
  const ffmpegPathHash = createHash('sha256')
    .update(ffmpegExecutable)
    .digest('hex')
    .slice(0, 16);
  const wrapperDirectory = path.join(
    stateRoot,
    'runtime',
    'ffmpeg-bin',
    ffmpegPathHash,
  );
  fs.mkdirSync(wrapperDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(wrapperDirectory, 0o700);

  // agent-browser 0.34 pipes FFmpeg stderr without draining progress output.
  // Suppress periodic stats so longer recordings cannot fill that pipe and
  // block recorder finalization.
  const wrapperPath = path.join(wrapperDirectory, 'ffmpeg');
  const contents =
    `#!/bin/sh\n` +
    `exec ${shellSingleQuote(ffmpegExecutable)} -nostats -loglevel error "$@"\n`;
  if (readFileIfPresent(wrapperPath) !== contents) {
    writeAtomicExecutable(wrapperPath, contents);
  } else {
    fs.chmodSync(wrapperPath, 0o700);
  }
  return wrapperDirectory;
}

function readFileIfPresent(filePath: string): string | null {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function writeAtomicExecutable(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, { flag: 'wx', mode: 0o700 });
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o700);
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
