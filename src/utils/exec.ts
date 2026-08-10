import { execSync, type ChildProcess } from 'child_process';
import { spawnShellCommand } from './process.js';

export class ProofShotError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'ProofShotError';
  }
}

export interface AgentBrowserCommandOptions {
  configPath?: string;
  session?: string;
  socketDir?: string;
  timeoutMs?: number;
}

let defaultAgentBrowserOptions: Pick<AgentBrowserCommandOptions, 'configPath' | 'socketDir'> = {};

export function setAgentBrowserDefaults(
  options: Pick<AgentBrowserCommandOptions, 'configPath' | 'socketDir'>,
): void {
  defaultAgentBrowserOptions = { ...options };
}

export function getAgentBrowserEnvironment(
  options: Pick<AgentBrowserCommandOptions, 'socketDir'> = {},
): NodeJS.ProcessEnv {
  const socketDir = options.socketDir ?? defaultAgentBrowserOptions.socketDir;
  return {
    ...process.env,
    AGENT_BROWSER_IDLE_TIMEOUT_MS:
      process.env.AGENT_BROWSER_IDLE_TIMEOUT_MS || '1800000',
    ...(socketDir ? { AGENT_BROWSER_SOCKET_DIR: socketDir } : {}),
  };
}

export function quoteShellArgument(value: string): string {
  const escaped = value.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

export function buildAgentBrowserCommand(
  command: string,
  options: Pick<AgentBrowserCommandOptions, 'configPath' | 'session'> = {},
): string {
  const mergedOptions = {
    ...defaultAgentBrowserOptions,
    ...options,
  };
  const configFlag = mergedOptions.configPath
    ? ` --config ${quoteShellArgument(mergedOptions.configPath)}`
    : '';
  const sessionFlag = mergedOptions.session
    ? ` --session ${quoteShellArgument(mergedOptions.session)}`
    : '';
  return `agent-browser${configFlag}${sessionFlag} ${command}`;
}

/**
 * Execute an agent-browser command via CLI.
 * agent-browser uses a Rust CLI + persistent Node.js daemon architecture,
 * so calling it via CLI is the intended usage pattern.
 */
export function ab(
  command: string,
  timeoutOrOptions: number | AgentBrowserCommandOptions = 30000,
): string {
  const options =
    typeof timeoutOrOptions === 'number'
      ? { timeoutMs: timeoutOrOptions }
      : timeoutOrOptions;
  const fullCommand = buildAgentBrowserCommand(command, options);
  try {
    return execSync(fullCommand, {
      encoding: 'utf-8',
      timeout: options.timeoutMs ?? 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getAgentBrowserEnvironment(options),
    }).trim();
  } catch (error: any) {
    const stderr = error?.stderr?.toString?.() || '';
    const message = stderr || error?.message || 'Unknown error';
    throw new ProofShotError(
      `Browser command failed: ${fullCommand}\n${message}`,
      error,
    );
  }
}

export function exec(command: string, timeoutMs = 30000): string {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error: any) {
    const stderr = error?.stderr?.toString?.() || '';
    throw new ProofShotError(`Command failed: ${command}\n${stderr}`, error);
  }
}

export function spawnBackground(
  command: string,
  cwd?: string,
): ChildProcess {
  const proc = spawnShellCommand(command, {
    cwd: cwd || process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  proc.unref();
  return proc;
}
