import { execFileSync } from 'child_process';
import {
  captureProcessIdentity,
  spawnShellCommand,
  terminateOwnedProcessTree,
} from '../utils/process.js';
import type { ProcessIdentity } from '../utils/process.js';

type CommandOutcome =
  | { kind: 'exit'; code: number | null }
  | { kind: 'timeout' };

export function assertTmuxAvailable(): void {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'pipe' });
  } catch {
    throw new Error('tmux is required for environment.kind "tmux".');
  }
}

/**
 * `maxBuffer` defaults to Node's 1 MB, which is smaller than the scrollback
 * ProofShot budgets for pane history, so callers that read bulk output must
 * raise it or the whole start fails with ENOBUFS.
 */
export function tmuxExec(
  socketPath: string,
  args: string[],
  options: { maxBuffer?: number } = {},
): string {
  return execFileSync('tmux', ['-S', socketPath, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
  }).trimEnd();
}

export async function runCommand(
  command: string,
  cwd: string,
  onStarted?: (identity: ProcessIdentity) => void,
  timeoutMs = 30_000,
): Promise<string> {
  const child = spawnShellCommand(command, {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const identity = child.pid ? captureProcessIdentity(child.pid) : null;
  if (!identity) {
    // Without an identity there is nothing to record in `.session.json`, so the
    // just-spawned pid is the only handle left for avoiding an orphan launcher.
    try {
      if (child.pid) {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch {
      // The launcher may already have exited.
    }
    throw new Error('ProofShot could not capture the external launcher identity.');
  }
  try {
    onStarted?.(identity);
  } catch (error) {
    await terminateOwnedProcessTree(identity);
    throw error;
  }

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const outcome = await new Promise<CommandOutcome>((resolve, reject) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ kind: 'exit', code });
    });
  });
  if (outcome.kind === 'timeout') {
    await terminateOwnedProcessTree(identity);
    throw new Error(`External environment command timed out after ${timeoutMs}ms.`);
  }
  const exitCode = outcome.code;
  if (exitCode !== 0) {
    await terminateOwnedProcessTree(identity);
    throw new Error(
      `External environment command failed with code ${String(exitCode)}: ${stderr.trim()}`,
    );
  }
  return stdout.trim();
}
