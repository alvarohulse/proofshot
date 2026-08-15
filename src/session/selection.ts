import * as path from 'path';
import type { EnvironmentState } from '../environment/types.js';
import { ownedProcessTreeIsAlive, type ProcessIdentity } from '../utils/process.js';
import {
  getRegisteredSession,
  listRegisteredSessions,
} from './registry.js';
import type { SessionState } from './state.js';

type ResolveSessionOptions = {
  controlDir: string;
  sessionName?: string;
};

export function listSessionsForControlDir(controlDir: string): SessionState[] {
  const resolvedControlDir = path.resolve(controlDir);
  return listRegisteredSessions().filter((session) =>
    path.resolve(session.controlDir ?? session.outputDir) === resolvedControlDir,
  );
}

export function resolveLiveSession(
  options: ResolveSessionOptions,
): SessionState | null {
  if (options.sessionName) {
    const session = getRegisteredSession(options.sessionName);
    if (!session) {
      throw new Error(
        `No registered ProofShot session named "${options.sessionName}".`,
      );
    }
    return session;
  }

  const sessions = listSessionsForControlDir(options.controlDir).filter(
    (session) => session.lifecycleStatus !== 'recovery',
  );
  if (sessions.length === 0) {
    return null;
  }
  if (sessions.length === 1) {
    return sessions[0];
  }

  const choices = sessions.map((session) => `  ${session.sessionName}`).join('\n');
  throw new Error(
    'Multiple active ProofShot sessions match this worktree. ' +
      'Re-run with --session <id>:\n' +
      choices,
  );
}

export function sessionHasVerifiedLiveOwnership(
  session: SessionState,
): boolean {
  return collectProcessIdentities(session).some(ownedProcessTreeIsAlive);
}

function collectProcessIdentities(session: SessionState): ProcessIdentity[] {
  const identities: ProcessIdentity[] = [];
  appendIdentity(identities, session.browserProcess);
  appendIdentity(identities, session.serverProcess);
  appendEnvironmentIdentities(identities, session.environment);
  return identities;
}

function appendEnvironmentIdentities(
  identities: ProcessIdentity[],
  environment: EnvironmentState | null | undefined,
): void {
  if (!environment) {
    return;
  }
  switch (environment.kind) {
    case 'tmux':
      appendIdentity(identities, environment.serverProcess);
      for (const capture of environment.captures) {
        appendIdentity(identities, capture.process);
      }
      return;
    case 'processes':
      for (const capture of environment.processes) {
        appendIdentity(identities, capture.process);
      }
      return;
    case 'launcher':
      appendIdentity(identities, environment.launcher.process);
      return;
    default: {
      const exhaustiveEnvironment: never = environment;
      return exhaustiveEnvironment;
    }
  }
}

function appendIdentity(
  identities: ProcessIdentity[],
  identity: ProcessIdentity | null | undefined,
): void {
  if (identity) {
    identities.push(identity);
  }
}
