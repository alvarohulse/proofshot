import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  captureProcessIdentity,
  type ProcessIdentity,
} from '../utils/process.js';

export const UNIX_SOCKET_PATH_MAX_BYTES = 103;

function assertOwnedDirectory(directory: string): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Agent-browser socket path is not a real directory: ${directory}`);
  }

  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) {
    throw new Error(
      `Agent-browser socket directory is owned by uid ${stat.uid}, expected ${uid}: ${directory}`,
    );
  }

  fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  if (uid !== undefined) fs.chmodSync(directory, 0o700);
}

/**
 * Prepare a short, user-owned socket directory that is stable across the
 * separate `start`, `exec`, and `stop` CLI processes in one environment.
 */
export function prepareAgentBrowserSocketDir(
  sessionName: string,
  env: NodeJS.ProcessEnv = process.env,
  accountHome = os.userInfo().homedir,
): string {
  const uid = process.getuid?.() ?? process.pid;
  const explicit = env.AGENT_BROWSER_SOCKET_DIR;
  const systemRuntime = `/run/user/${uid}`;
  let runtimeRoot = accountHome;
  if (!explicit && env.XDG_RUNTIME_DIR && path.isAbsolute(env.XDG_RUNTIME_DIR)) {
    runtimeRoot = env.XDG_RUNTIME_DIR;
  } else if (!explicit && fs.existsSync(systemRuntime)) {
    try {
      assertOwnedDirectory(systemRuntime);
      runtimeRoot = systemRuntime;
    } catch {
      // Fall back to the real account home, independently of isolated $HOME.
    }
  }
  const directory = explicit
    ? path.resolve(explicit)
    : runtimeRoot === systemRuntime || runtimeRoot === env.XDG_RUNTIME_DIR
      ? path.join(runtimeRoot, 'proofshot', 'agent-browser')
      : path.join(runtimeRoot, '.cache', 'proofshot', 'run', 'agent-browser');

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertOwnedDirectory(directory);

  const socketPath = path.join(directory, `${sessionName}.sock`);
  const byteLength = Buffer.byteLength(socketPath);
  if (byteLength > UNIX_SOCKET_PATH_MAX_BYTES) {
    throw new Error(
      `Agent-browser socket path is ${byteLength} bytes (max ${UNIX_SOCKET_PATH_MAX_BYTES}): ${socketPath}\n` +
        'Set AGENT_BROWSER_SOCKET_DIR to a shorter user-owned directory and retry.',
    );
  }

  return directory;
}

/** Read the exact daemon PID written for this isolated agent-browser session. */
export function captureAgentBrowserProcessIdentity(
  socketDir: string,
  sessionName: string,
): ProcessIdentity | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) return null;

  try {
    assertOwnedDirectory(socketDir);
    const pidPath = path.join(socketDir, `${sessionName}.pid`);
    const pid = Number(fs.readFileSync(pidPath, 'utf-8').trim());
    const identity = captureProcessIdentity(pid);
    if (!identity || identity.sessionId !== identity.pid) return null;
    return identity;
  } catch {
    return null;
  }
}
