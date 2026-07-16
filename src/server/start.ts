import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { Transform } from 'stream';
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
 * Create a Transform stream that prepends an epoch-ms timestamp to each line.
 * Format: "1720612345678\toriginal line\n"
 */
function createTimestampTransform(): Transform {
  let buffer = '';
  return new Transform({
    transform(chunk, _encoding, callback) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        this.push(`${Date.now()}\t${line}\n`);
      }
      callback();
    },
    flush(callback) {
      if (buffer) this.push(`${Date.now()}\t${buffer}\n`);
      callback();
    },
  });
}

/**
 * Start a dev server command and wait for it to be ready.
 * Only called when the agent provides a --run command.
 * Pipes stdout/stderr to logPath for server error capture.
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
  const proc = spawnShellCommand(command, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      [SERVER_OWNERSHIP_ENV]: ownershipToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
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

    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const tsOut = createTimestampTransform();
    const tsErr = createTimestampTransform();
    proc.stdout?.pipe(tsOut).pipe(logStream, { end: false });
    proc.stderr?.pipe(tsErr).pipe(logStream, { end: false });
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
