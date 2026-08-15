import chalk from 'chalk';
import { PROOFSHOT_VERSION } from '../version.js';
import { findConfigPath, loadConfig } from '../utils/config.js';
import { findExecutablePath, readCommandVersion } from '../utils/process.js';
import { resolveSessionControlDir } from '../session/state.js';
import { listRegisteredSessions } from '../session/registry.js';
import {
  listSessionsForControlDir,
  sessionHasVerifiedLiveOwnership,
} from '../session/selection.js';

function statusLabel(ok: boolean, text: string): string {
  return ok ? `${chalk.green('✓')} ${text}` : `${chalk.yellow('⚠')} ${text}`;
}

function printLine(label: string, value: string): void {
  console.log(`${label.padEnd(14)} ${value}`);
}

export async function doctorCommand(): Promise<void> {
  const configPath = findConfigPath();
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);
  const activeSessions = listSessionsForControlDir(controlDir).filter(
    sessionHasVerifiedLiveOwnership,
  );
  const session = activeSessions.length === 1 ? activeSessions[0] : null;
  const registeredSessions = listRegisteredSessions();

  const agentBrowserPath = findExecutablePath('agent-browser');
  const ffmpegPath = findExecutablePath('ffmpeg');
  const agentBrowserVersion = readCommandVersion('agent-browser');
  const ffmpegVersion = readCommandVersion('ffmpeg');

  console.log(chalk.bold('ProofShot Doctor'));
  console.log('');

  printLine('ProofShot', PROOFSHOT_VERSION);
  printLine('Config', configPath || chalk.dim('not found'));
  printLine('Output', config.output);
  printLine('Control state', controlDir);
  printLine('Browser mode', config.headless ? 'headless' : 'headed');
  printLine('Viewport', `${config.viewport.width}x${config.viewport.height}`);
  console.log('');

  console.log(statusLabel(Boolean(agentBrowserPath), 'agent-browser'));
  printLine('Path', agentBrowserPath || chalk.dim('not found'));
  printLine('Version', agentBrowserVersion || chalk.dim('not available'));
  console.log('');

  console.log(statusLabel(Boolean(ffmpegPath), 'ffmpeg'));
  printLine('Path', ffmpegPath || chalk.dim('not found'));
  printLine('Version', ffmpegVersion || chalk.dim('not available'));
  console.log('');

  console.log(statusLabel(activeSessions.length > 0, 'active session'));
  printLine('Active here', String(activeSessions.length));
  printLine('Sessions', String(registeredSessions.length));
  if (session) {
    printLine('Session dir', session.sessionDir);
    printLine('Recording', session.recordingActive ? 'active' : 'stopped');
    printLine('Port', String(session.port));
    if (session.targetUrl) printLine('Target', session.targetUrl);
  } else {
    printLine(
      'Session dir',
      activeSessions.length > 1 ? chalk.dim('multiple; use session list') : chalk.dim('none'),
    );
  }
}
