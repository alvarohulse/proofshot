import chalk from 'chalk';
import {
  discardSession,
  isSessionStillStarting,
  stopOwnedServer,
} from '../session/lifecycle.js';
import {
  listActiveBrowserSessionNames,
  listRegisteredSessions,
  unregisterSession,
} from '../session/registry.js';
import { clearSession, type SessionState } from '../session/state.js';

type SessionStatus = 'active' | 'orphaned' | 'starting' | 'unknown';

type SessionListOptions = {
  json?: boolean;
};

type SessionCleanOptions = {
  all?: boolean;
};

type SessionListEntry = {
  id: string;
  status: SessionStatus;
  startedAt: string;
  startDirectory: string | null;
  outputDir: string;
  port: number;
};

export async function sessionListCommand(options: SessionListOptions): Promise<void> {
  const sessions = listRegisteredSessions();
  let activeBrowserSessions: Set<string> | null = null;

  try {
    activeBrowserSessions = listActiveBrowserSessionNames();
  } catch {
    // Registry data remains useful when agent-browser is unavailable.
  }

  const entries = sessions.map((session) =>
    buildSessionListEntry(session, activeBrowserSessions),
  );

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
    const status =
      entry.status === 'active'
        ? chalk.green(entry.status)
        : entry.status === 'starting'
          ? chalk.cyan(entry.status)
        : entry.status === 'orphaned'
          ? chalk.yellow(entry.status)
          : chalk.dim(entry.status);
    console.log(`${entry.id}  ${status}`);
    console.log(chalk.dim(`  Started: ${entry.startedAt}`));
    console.log(chalk.dim(`  From:    ${entry.startDirectory || 'unknown'}`));
    console.log(chalk.dim(`  Output:  ${entry.outputDir}`));
    console.log(chalk.dim(`  Port:    ${entry.port}`));
  }
}

export async function sessionCleanCommand(options: SessionCleanOptions): Promise<void> {
  const sessions = listRegisteredSessions();
  if (sessions.length === 0) {
    console.log('No registered ProofShot sessions.');
    return;
  }

  let activeBrowserSessions: Set<string>;
  if (options.all) {
    activeBrowserSessions = new Set(sessions.map((session) => session.sessionName));
  } else {
    try {
      activeBrowserSessions = listActiveBrowserSessionNames();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Unable to inspect agent-browser sessions: ${message}`));
      process.exit(1);
    }
  }

  const sessionsToClean = options.all
    ? sessions.filter((session) => !isSessionStillStarting(session))
    : sessions.filter(
        (session) =>
          !isSessionStillStarting(session) &&
          !activeBrowserSessions.has(session.sessionName),
      );

  if (sessionsToClean.length === 0) {
    console.log('No orphaned ProofShot sessions.');
    return;
  }

  let failures = 0;
  for (const session of sessionsToClean) {
    try {
      if (activeBrowserSessions.has(session.sessionName)) {
        discardSession(session);
      } else {
        stopOwnedServer(session);
        clearSession(session.outputDir, session.sessionName);
        unregisterSession(session.sessionName);
      }
      console.log(`${chalk.green('✓')} Cleaned ${session.sessionName}`);
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${chalk.red('✗')} Kept ${session.sessionName}: ${message}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

function buildSessionListEntry(
  session: SessionState,
  activeBrowserSessions: Set<string> | null,
): SessionListEntry {
  const status =
    isSessionStillStarting(session)
      ? 'starting'
      : activeBrowserSessions === null
      ? 'unknown'
      : activeBrowserSessions.has(session.sessionName)
        ? 'active'
        : 'orphaned';

  return {
    id: session.sessionName,
    status,
    startedAt: session.startedAt,
    startDirectory: session.startDirectory || null,
    outputDir: session.outputDir,
    port: session.port,
  };
}
