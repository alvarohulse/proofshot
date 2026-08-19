import * as fs from 'fs';
import * as path from 'path';
import { startCommand } from './start.js';
import {
  execCommand,
  validateProofShotExecCommand,
} from './exec.js';
import { stopCommand } from './stop.js';
import { loadReplayCase, renderUserTesting } from '../replay/case.js';

export async function replayCommand(casePath: string): Promise<void> {
  const replay = loadReplayCase(casePath);
  for (const step of replay.steps) {
    validateProofShotExecCommand(step.command);
  }
  const receipt = await startCommand({
    description: replay.description,
    ...replay.start,
  });
  if (!receipt) {
    throw new Error('ProofShot did not return a replay session receipt.');
  }

  let stopped = false;
  let primaryError: unknown;
  try {
    for (const step of replay.steps) {
      await runReplayStep(step.command, receipt.sessionId);
    }
    writeUserTesting(receipt.sessionDir, renderUserTesting(replay));
    await stopCommand({ session: receipt.sessionId });
    stopped = true;
    const verdict = readVerdict(receipt.sessionDir);
    if (verdict.status !== 'PASS') {
      const reasons =
        verdict.reasons.length > 0 ? `: ${verdict.reasons.join(' ')}` : '';
      throw new Error(`Replay finalized with verdict ${verdict.status}${reasons}`);
    }
    console.log(
      JSON.stringify({
        result: 'PASS',
        session: receipt.sessionId,
        sessionDir: receipt.sessionDir,
      }),
    );
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (!stopped) {
      try {
        await stopCommand({ session: receipt.sessionId });
      } catch (cleanupError) {
        if (primaryError) {
          throw new AggregateError(
            [primaryError, cleanupError],
            'Replay failed and exact ProofShot cleanup also failed.',
          );
        }
        throw cleanupError;
      }
    }
  }
}

async function runReplayStep(
  command: string[],
  sessionId: string,
): Promise<void> {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await execCommand(command, { session: sessionId, throwOnFailure: true });
    if (process.exitCode && process.exitCode !== 0) {
      throw new Error(
        `Replay step failed (${process.exitCode}): ${command[0]}`,
      );
    }
  } finally {
    process.exitCode = previousExitCode;
  }
}

function writeUserTesting(sessionDir: string, contents: string): void {
  const filePath = path.join(sessionDir, 'USER_TESTING.md');
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function readVerdict(sessionDir: string): {
  status: string;
  reasons: string[];
} {
  const verdictPath = path.join(sessionDir, 'verdict.json');
  let contents: string;
  try {
    contents = fs.readFileSync(verdictPath, 'utf-8');
  } catch {
    throw new Error('Replay did not produce a finalized verdict.');
  }
  const parsed = JSON.parse(contents) as {
    status?: unknown;
    reasons?: unknown;
  };
  return {
    status: typeof parsed.status === 'string' ? parsed.status : 'UNKNOWN',
    reasons: Array.isArray(parsed.reasons)
      ? parsed.reasons.filter(
          (reason): reason is string => typeof reason === 'string',
        )
      : [],
  };
}
