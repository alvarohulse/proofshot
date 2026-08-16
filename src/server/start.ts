import * as fs from 'fs';
import { spawn } from 'child_process';
import { isPortOpen, waitForPort } from '../utils/port.js';
import {
  captureProcessIdentity,
  getShellExecutable,
  isDetachedProcessIdentity,
  ownedProcessTreeIsAlive,
  terminateOwnedProcessTree,
  terminateProcessTree,
  type ProcessIdentity,
} from '../utils/process.js';

export interface ServerStartResult {
  alreadyRunning: boolean;
  port: number;
  process: ProcessIdentity;
}

// A detached supervisor keeps timestamping server output after the short-lived
// `proofshot start` process exits. It and the server share one new process
// session, whose immutable identity is persisted for exact later cleanup.
const SERVER_RUNNER_SOURCE = String.raw`
const fs = require('fs');
const { spawn } = require('child_process');
const [command, cwd, logPath, shell] = process.argv.slice(1);
const fd = fs.openSync(logPath, 'a', 0o600);
fs.chmodSync(logPath, 0o600);
let closed = false;
const write = (text) => {
  if (!closed) fs.writeSync(fd, Date.now() + '\t' + text + '\n');
};
const child = spawn(command, {
  cwd,
  shell,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const attach = (stream) => {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) write(line);
  });
  stream.on('end', () => {
    if (buffer) write(buffer);
    buffer = '';
  });
};
attach(child.stdout);
attach(child.stderr);
child.on('error', (error) => write(error.stack || error.message || String(error)));
child.on('close', (code) => {
  closed = true;
  fs.closeSync(fd);
  process.exit(code == null ? 1 : code);
});
`;

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
  onStarted?: (result: ServerStartResult) => void,
): Promise<ServerStartResult> {
  // Port ownership is not session ownership. Never kill an unrelated listener.
  if (await isPortOpen(port)) {
    throw new Error(
      `Port ${port} is already in use by a process ProofShot did not start.\n` +
        'Choose another port or stop that process explicitly, then retry.',
    );
  }

  // Ensure log creation errors surface before launching the detached runner.
  const logFd = fs.openSync(logPath, 'a', 0o600);
  fs.closeSync(logFd);
  fs.chmodSync(logPath, 0o600);
  const proc = spawn(process.execPath, [
    '-e',
    SERVER_RUNNER_SOURCE,
    command,
    process.cwd(),
    logPath,
    getShellExecutable(),
  ], {
    stdio: 'ignore',
    detached: true,
  });

  proc.unref();
  let processIdentity = proc.pid ? captureProcessIdentity(proc.pid) : null;
  for (let attempt = 0; !processIdentity && attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    processIdentity = proc.pid ? captureProcessIdentity(proc.pid) : null;
  }

  if (!processIdentity || !isDetachedProcessIdentity(processIdentity)) {
    try {
      if (proc.pid) terminateProcessTree(proc.pid);
    } catch {
      // The child may already have exited.
    }
    throw new Error('ProofShot could not record an exact identity for the dev server process.');
  }
  const result = { alreadyRunning: false, port, process: processIdentity };
  try {
    onStarted?.(result);
  } catch (error) {
    await terminateOwnedProcessTree(processIdentity);
    throw error;
  }

  try {
    await waitForPort(port, startupTimeout);
  } catch (error) {
    // Clean up the spawned process if it failed to start on the expected port
    await terminateOwnedProcessTree(processIdentity);
    throw new Error(
      `Failed to start the configured dev server on port ${port}.\n` +
        `Make sure the command is correct and the port is available.\n` +
        `Original error: ${error instanceof Error ? error.message : error}`,
    );
  }

  // Small delay for stability
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (!ownedProcessTreeIsAlive(processIdentity)) {
    await terminateOwnedProcessTree(processIdentity);
    throw new Error(
      `The configured dev server process exited after port ${port} became available.\n` +
        'Another listener may have won a concurrent startup race; choose a different port and retry.',
    );
  }

  return result;
}
