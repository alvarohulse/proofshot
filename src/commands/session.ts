import chalk from 'chalk';
import { cleanupFailedStart } from '../session/lifecycle.js';
import { setAgentBrowserDefaults } from '../utils/exec.js';
import {
  getRegisteredSession,
  listRegisteredSessions,
  registerSession,
  unregisterSession,
} from '../session/registry.js';
import {
  clearSession,
  hasActiveSession,
  loadSession,
  saveSession,
  type SessionState,
} from '../session/state.js';
import { ownedProcessTreeIsAlive } from '../utils/process.js';

type SessionStatus = 'active' | 'starting' | 'recovery' | 'stale';

type SessionListOptions = {
  json?: boolean;
};

type SessionCleanOptions = {
  all?: boolean;
  session?: string;
};

type SessionListEntry = {
  id: string;
  status: SessionStatus;
  startedAt: string;
  startDirectory: string | null;
  outputDir: string;
  cleanupError: string | null;
};

export async function sessionListCommand(options: SessionListOptions): Promise<void> {
  const entries = listRegisteredSessions().map(buildSessionListEntry);
  if (options.json) {
    console.log(JSON.stringify({ sessions: entries }, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log('No registered ProofShot sessions.');
    return;
  }

  console.log(chalk.bold('ProofShot Sessions'));
  console.log('');
  for (const entry of entries) {
    console.log(`${entry.id}  ${formatStatus(entry.status)}`);
    console.log(chalk.dim(`  Started: ${entry.startedAt}`));
    console.log(chalk.dim(`  From:    ${entry.startDirectory || 'unknown'}`));
    console.log(chalk.dim(`  Output:  ${entry.outputDir}`));
    if (entry.cleanupError) {
      console.log(chalk.yellow(`  Cleanup: ${entry.cleanupError}`));
    }
  }
}

export async function sessionCleanCommand(options: SessionCleanOptions): Promise<void> {
  const sessions = selectSessionsToClean(options);
  if (sessions.length === 0) {
    console.log('No recoverable ProofShot sessions.');
    return;
  }

  let failures = 0;
  for (const session of sessions) {
    setAgentBrowserDefaults({
      configPath: session.agentBrowserConfigPath,
      socketDir: session.agentBrowserSocketDir,
    });
    try {
      await cleanupFailedStart(session);
      clearMatchingControlState(session);
      unregisterSession(session.sessionName);
      console.log(`${chalk.green('✓')} Cleaned ${session.sessionName}`);
    } catch (error) {
      failures += 1;
      session.lifecycleStatus = 'recovery';
      session.cleanupError = error instanceof Error ? error.message : String(error);
      persistMatchingControlState(session);
      registerSession(session);
      console.error(`${chalk.red('✗')} Kept ${session.sessionName}: ${session.cleanupError}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

function clearMatchingControlState(session: SessionState): void {
  const controlDir = session.controlDir ?? session.outputDir;
  if (!hasActiveSession(controlDir)) return;
  const activeSession = loadControlSessionSafely(controlDir);
  if (activeSession?.sessionName === session.sessionName) {
    clearSession(controlDir);
    return;
  }
  throw new Error(
    `Control state at ${controlDir} is corrupt or belongs to another session; it was not removed.`,
  );
}

function persistMatchingControlState(session: SessionState): void {
  const controlDir = session.controlDir ?? session.outputDir;
  const activeSession = loadControlSessionSafely(controlDir);
  if (
    !hasActiveSession(controlDir) ||
    activeSession?.sessionName === session.sessionName
  ) {
    saveSession(session, controlDir);
  }
}

function loadControlSessionSafely(controlDir: string): SessionState | null {
  try {
    return loadSession(controlDir);
  } catch {
    return null;
  }
}

function selectSessionsToClean(options: SessionCleanOptions): SessionState[] {
  if (options.session) {
    const session = getRegisteredSession(options.session);
    if (!session) {
      throw new Error(`No registered ProofShot session named "${options.session}".`);
    }
    return [session];
  }

  const sessions = listRegisteredSessions();
  if (options.all) {
    return sessions;
  }
  return sessions.filter((session) => {
    const status = getSessionStatus(session);
    return status === 'recovery' || status === 'stale';
  });
}

function buildSessionListEntry(session: SessionState): SessionListEntry {
  return {
    id: session.sessionName,
    status: getSessionStatus(session),
    startedAt: session.startedAt,
    startDirectory: session.startDirectory || null,
    outputDir: session.outputDir,
    cleanupError: session.cleanupError || null,
  };
}

function getSessionStatus(session: SessionState): SessionStatus {
  if (session.lifecycleStatus === 'recovery') {
    return 'recovery';
  }
  if (session.lifecycleStatus === 'starting') {
    return 'starting';
  }
  if (
    (session.browserProcess && ownedProcessTreeIsAlive(session.browserProcess)) ||
    (session.serverProcess && ownedProcessTreeIsAlive(session.serverProcess))
  ) {
    return 'active';
  }
  return 'stale';
}

function formatStatus(status: SessionStatus): string {
  switch (status) {
    case 'active':
      return chalk.green(status);
    case 'starting':
      return chalk.cyan(status);
    case 'recovery':
      return chalk.yellow(status);
    case 'stale':
      return chalk.dim(status);
    default: {
      const exhaustiveStatus: never = status;
      return exhaustiveStatus;
    }
  }
}
