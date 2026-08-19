import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { ab } from '../utils/exec.js';

const RECORDING_FINALIZATION_TIMEOUT_MS = 120_000;
const RECORDING_STABILITY_TIMEOUT_MS = 5_000;
const RECORDING_STABILITY_MAX_WAIT_MS = 120_000;
const RECORDING_STABILITY_POLL_MS = 100;

/**
 * Start video recording to the given file path.
 */
export function startRecording(outputPath: string, sessionName?: string): void {
  ab(['record', 'start', outputPath], { timeoutMs: 10000, session: sessionName });
}

/**
 * Stop the current recording.
 */
export function stopRecording(sessionName?: string): void {
  try {
    ab(['record', 'stop'], {
      timeoutMs: RECORDING_FINALIZATION_TIMEOUT_MS,
      session: sessionName,
    });
  } catch (error) {
    if (/no recording in progress/i.test(
      error instanceof Error ? error.message : String(error),
    )) {
      return;
    }
    throw error;
  }
}

/**
 * Flush the recorder and prove that it produced a stable, non-empty file.
 * Browser cleanup must not run until this completes, otherwise killing the
 * daemon can destroy the only copy of an in-flight recording.
 */
export async function finalizeRecording(
  outputPath: string,
  sessionName?: string,
): Promise<void> {
  stopRecording(sessionName);
  await verifyFinalizedRecording(outputPath);
}

export async function verifyFinalizedRecording(
  outputPath: string,
): Promise<void> {
  await waitForStableRecording(outputPath);
}

async function waitForStableRecording(outputPath: string): Promise<void> {
  const absoluteDeadline = Date.now() + RECORDING_STABILITY_MAX_WAIT_MS;
  let quietDeadline = Date.now() + RECORDING_STABILITY_TIMEOUT_MS;
  let previousSize = -1;
  let stableObservations = 0;

  while (Date.now() <= Math.min(quietDeadline, absoluteDeadline)) {
    const size = readRegularFileSize(outputPath);
    if (size > 0 && size === previousSize) {
      stableObservations += 1;
      if (stableObservations >= 2 && isPlayableRecording(outputPath)) return;
    } else {
      stableObservations = 0;
      if (size > previousSize) {
        quietDeadline = Date.now() + RECORDING_STABILITY_TIMEOUT_MS;
      }
    }
    previousSize = size;
    await new Promise((resolve) =>
      setTimeout(resolve, RECORDING_STABILITY_POLL_MS),
    );
  }

  throw new Error(
    `Recording finalization did not produce a stable non-empty file: ${outputPath}`,
  );
}

function isPlayableRecording(outputPath: string): boolean {
  try {
    execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', outputPath,
    ], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function readRegularFileSize(filePath: string): number {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink() ? stat.size : -1;
  } catch {
    return -1;
  }
}

/**
 * Take a screenshot and save to the given path.
 */
export function takeScreenshot(outputPath: string, fullPage = true, sessionName?: string): void {
  ab(['screenshot', outputPath, ...(fullPage ? ['--full'] : [])], {
    timeoutMs: 15000,
    session: sessionName,
  });
}

/**
 * Take an annotated screenshot (labels interactive elements).
 */
export function takeAnnotatedScreenshot(outputPath: string, sessionName?: string): void {
  ab(['screenshot', outputPath, '--annotate'], {
    timeoutMs: 15000,
    session: sessionName,
  });
}

/**
 * Compare two screenshots and output a diff image.
 * Returns the mismatch percentage, or null if diff failed.
 */
export function diffScreenshots(
  baseline: string,
  current: string,
  outputPath: string,
  sessionName?: string,
): number | null {
  try {
    const result = ab(['diff', 'screenshot', baseline, current, outputPath], {
      timeoutMs: 15000,
      session: sessionName,
    });
    // Parse mismatch percentage from output
    const match = result.match(/([\d.]+)%/);
    return match ? parseFloat(match[1]) : null;
  } catch {
    return null;
  }
}
