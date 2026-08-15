import chalk from 'chalk';
import { cleanupFailedStart } from '../session/lifecycle.js';
import { setAgentBrowserDefaults } from '../utils/exec.js';
import {
  claimSessionOperation,
  getRegisteredSession,
  listRegisteredSessions,
  registerSession,
  releaseSessionOperation,
  unregisterSession,
} from '../session/registry.js';
import { sessionHasVerifiedLiveOwnership } from '../session/selection.js';
import type { SessionState } from '../session/state.js';

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
    let recoveryLease;
    try {
      recoveryLease = claimSessionOperation(session, 'recovery');
    } catch (error) {
      failures += 1;
      console.error(
        `${chalk.red('✗')} Kept ${session.sessionName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    setAgentBrowserDefaults({
      allowedDomains: session.agentBrowserAllowedDomains,
      configPath: session.agentBrowserConfigPath,
      executablePath: session.agentBrowserExecutablePath,
      namespace: session.agentBrowserNamespace,
      socketDir: session.agentBrowserSocketRoot || session.agentBrowserSocketDir,
    });
    try {
      await cleanupFailedStart(session);
      releaseSessionOperation(session, recoveryLease);
      unregisterSession(session.sessionName);
      console.log(`${chalk.green('✓')} Cleaned ${session.sessionName}`);
    } catch (error) {
      failures += 1;
      session.lifecycleStatus = 'recovery';
      session.cleanupError = error instanceof Error ? error.message : String(error);
      registerSession(session);
      console.error(`${chalk.red('✗')} Kept ${session.sessionName}: ${session.cleanupError}`);
    } finally {
      if (session.operationLease?.id === recoveryLease.id) {
        releaseSessionOperation(session, recoveryLease);
      }
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
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
  if (sessionHasVerifiedLiveOwnership(session)) {
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
