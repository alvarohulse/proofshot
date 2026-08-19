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

  try {
    const discoveredFfmpeg =
      options.ffmpegExecutable ?? findExecutablePath('ffmpeg', platform);
    if (!discoveredFfmpeg) return null;

    const ffmpegExecutable = fs.realpathSync(discoveredFfmpeg);
    const executableStat = fs.statSync(ffmpegExecutable);
    if (!executableStat.isFile()) return null;
    fs.accessSync(ffmpegExecutable, fs.constants.X_OK);

    const stateRoot =
      options.stateRoot ??
      path.join(
        process.env.XDG_STATE_HOME || path.join(os.userInfo().homedir, '.local', 'state'),
        'proofshot',
      );
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
    if (wrapperDirectory.includes(path.delimiter)) return null;
    fs.mkdirSync(wrapperDirectory, { recursive: true, mode: 0o700 });
    const directoryStat = fs.lstatSync(wrapperDirectory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return null;
    if (typeof process.getuid === 'function' && directoryStat.uid !== process.getuid()) {
      return null;
    }
    fs.chmodSync(wrapperDirectory, 0o700);

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
  } catch {
    return null;
  }
}

function readFileIfPresent(filePath: string): string | null {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile()) return null;
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
