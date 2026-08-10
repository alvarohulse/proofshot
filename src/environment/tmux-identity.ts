import * as fs from 'fs';
import { tmuxExec } from './tmux-command.js';
import type { SocketIdentity, TmuxEnvironmentState } from './types.js';
import { processIdentityMatches } from '../utils/process.js';

export function captureSocketIdentity(socketPath: string): SocketIdentity {
  const stat = fs.lstatSync(socketPath);
  if (!stat.isSocket() || stat.isSymbolicLink()) {
    throw new Error(`tmux socket is not an owned Unix socket: ${socketPath}`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) {
    throw new Error(`tmux socket is owned by uid ${stat.uid}, expected ${uid}.`);
  }
  return { path: socketPath, inode: stat.ino, uid: stat.uid };
}

export function assertSocketIdentity(state: TmuxEnvironmentState): void {
  if (!fs.existsSync(state.socket.path)) {
    if (!processIdentityMatches(state.serverProcess)) {
      return;
    }
    throw new Error('Owned tmux socket disappeared while its server is still alive.');
  }
  const current = captureSocketIdentity(state.socket.path);
  if (current.inode !== state.socket.inode || current.uid !== state.socket.uid) {
    throw new Error('tmux socket identity changed; refusing widened cleanup.');
  }
}

export function tmuxHasSession(state: TmuxEnvironmentState): boolean {
  if (!processIdentityMatches(state.serverProcess)) {
    return false;
  }
  try {
    tmuxExec(state.socket.path, ['has-session', '-t', state.sessionName]);
    return true;
  } catch {
    return false;
  }
}
