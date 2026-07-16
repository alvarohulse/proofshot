import * as fs from 'fs';
import type { ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { isPortOpen, waitForPort } from '../utils/port.js';
import {
  getProcessStartTime,
  isProcessRunning,
  spawnShellCommand,
  terminateProcessTree,
  waitForProcessExit,
} from '../utils/process.js';

export interface ServerStartResult {
  alreadyRunning: boolean;
  port: number;
  pid: number | null;
  ownershipToken: string;
  processStartTime: string | null;
}

export const SERVER_OWNERSHIP_ENV = 'PROOFSHOT_SERVER_TOKEN';

export class DevServerStartError extends Error {
  constructor(
    message: string,
    public readonly recoveryState: ServerStartResult | null,
  ) {
    super(message);
    this.name = 'DevServerStartError';
  }
}

/**
 * Start a dev server command and wait for it to be ready.
 * Only called when the agent provides a --run command.
 * Writes stdout/stderr directly to logPath so the detached server does not
 * keep the ProofShot CLI process alive.
 */
export async function ensureDevServer(
  command: string,
  port: number,
  startupTimeout: number,
  logPath: string,
  onSpawn?: (server: ServerStartResult) => void,
): Promise<ServerStartResult> {
  if (await isPortOpen(port)) {
    throw new Error(
      `Port ${port} is already in use. Omit --run to use the existing server, ` +
        'or choose another port.',
    );
  }

  const ownershipToken = randomUUID();
  const proc = spawnLoggedServer(command, logPath, ownershipToken);
  const processStartTime =
    proc.pid === undefined ? null : getProcessStartTime(proc.pid);
  const serverState: ServerStartResult = {
    alreadyRunning: false,
    port,
    pid: proc.pid ?? null,
    ownershipToken,
    processStartTime,
  };

  try {
    onSpawn?.(serverState);
    proc.unref();

    await waitForPort(port, startupTimeout);
  } catch (error) {
    // Clean up the spawned process if it failed to start on the expected port
    let cleanupSucceeded = true;
    try {
      if (proc.pid) terminateProcessTree(proc.pid);
    } catch {
      cleanupSucceeded = proc.pid === undefined || !isProcessRunning(proc.pid);
    }
    if (proc.pid && cleanupSucceeded) {
      cleanupSucceeded = waitForProcessExit(proc.pid);
    }
    const message =
      `Failed to start dev server with "${command}" on port ${port}.\n` +
        `Make sure the command is correct and the port is available.\n` +
        `Original error: ${error instanceof Error ? error.message : error}`;
    throw new DevServerStartError(
      message,
      cleanupSucceeded
        ? null
        : serverState,
    );
  }

  // Small delay for stability
  await new Promise((resolve) => setTimeout(resolve, 1000));

  return serverState;
}

function spawnLoggedServer(
  command: string,
  logPath: string,
  ownershipToken: string,
): ChildProcess {
  const logFileDescriptor = fs.openSync(logPath, 'a');
  try {
    return spawnShellCommand(command, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        [SERVER_OWNERSHIP_ENV]: ownershipToken,
      },
      stdio: ['ignore', logFileDescriptor, logFileDescriptor],
      detached: true,
    });
  } finally {
    fs.closeSync(logFileDescriptor);
  }
}
