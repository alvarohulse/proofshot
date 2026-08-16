import { execFileSync } from 'child_process';
import { getIsolatedAgentBrowserEnvironment } from '../browser/isolation.js';
import { sanitizeDiagnosticMessage } from '../browser/provenance.js';

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
  allowedDomains?: string[];
  configPath?: string;
  executablePath?: string;
  json?: boolean;
  namespace?: string;
  session?: string;
  socketDir?: string;
  timeoutMs?: number;
}

export type AgentBrowserInvocation = {
  executablePath: string;
  args: string[];
};

let defaultAgentBrowserOptions: Pick<
  AgentBrowserCommandOptions,
  'allowedDomains' | 'configPath' | 'executablePath' | 'namespace' | 'socketDir'
> = {};

export function setAgentBrowserDefaults(
  options: Pick<
    AgentBrowserCommandOptions,
    'allowedDomains' | 'configPath' | 'executablePath' | 'namespace' | 'socketDir'
  >,
): void {
  defaultAgentBrowserOptions = { ...options };
}

export function getAgentBrowserEnvironment(
  options: Pick<
    AgentBrowserCommandOptions,
    'allowedDomains' | 'namespace' | 'socketDir'
  > = {},
): NodeJS.ProcessEnv {
  const allowedDomains =
    options.allowedDomains ?? defaultAgentBrowserOptions.allowedDomains;
  const socketDir = options.socketDir ?? defaultAgentBrowserOptions.socketDir;
  const namespace = options.namespace ?? defaultAgentBrowserOptions.namespace;
  return {
    ...getIsolatedAgentBrowserEnvironment(process.env),
    AGENT_BROWSER_IDLE_TIMEOUT_MS:
      process.env.AGENT_BROWSER_IDLE_TIMEOUT_MS || '1800000',
    ...(socketDir ? { AGENT_BROWSER_SOCKET_DIR: socketDir } : {}),
    ...(namespace ? { AGENT_BROWSER_NAMESPACE: namespace } : {}),
    ...(allowedDomains && allowedDomains.length > 0
      ? { AGENT_BROWSER_ALLOWED_DOMAINS: allowedDomains.join(',') }
      : {}),
  };
}

export function buildAgentBrowserInvocation(
  commandArgs: readonly string[],
  options: Pick<
    AgentBrowserCommandOptions,
    'configPath' | 'executablePath' | 'json' | 'session'
  > = {},
): AgentBrowserInvocation {
  const mergedOptions = {
    ...defaultAgentBrowserOptions,
    ...options,
  };
  if (!mergedOptions.executablePath) {
    throw new Error(
      'agent-browser executable path has not been verified for this ProofShot operation.',
    );
  }

  const args: string[] = [];
  if (mergedOptions.configPath) {
    args.push('--config', mergedOptions.configPath);
  }
  if (mergedOptions.session) {
    args.push('--session', mergedOptions.session);
  }
  if (mergedOptions.json) {
    args.push('--json');
  }
  args.push(...commandArgs);
  return {
    executablePath: mergedOptions.executablePath,
    args,
  };
}

export function executeAgentBrowser(
  commandArgs: readonly string[],
  options: AgentBrowserCommandOptions = {},
): string {
  const invocation = buildAgentBrowserInvocation(commandArgs, options);
  return execFileSync(invocation.executablePath, invocation.args, {
    encoding: 'utf-8',
    timeout: options.timeoutMs ?? 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: getAgentBrowserEnvironment(options),
  });
}

/**
 * Execute an agent-browser command via its exact executable and argv.
 * agent-browser uses a Rust CLI + persistent Node.js daemon architecture,
 * so calling it via CLI is the intended usage pattern.
 */
export function ab(
  commandArgs: readonly string[],
  timeoutOrOptions: number | AgentBrowserCommandOptions = 30000,
): string {
  const options =
    typeof timeoutOrOptions === 'number'
      ? { timeoutMs: timeoutOrOptions }
      : timeoutOrOptions;
  try {
    return executeAgentBrowser(commandArgs, options).trim();
  } catch (error: unknown) {
    const command = commandArgs[0] || 'command';
    const stderr = readProcessOutput(error, 'stderr');
    const message = sanitizeDiagnosticMessage(
      stderr || readErrorMessage(error) || 'Unknown error',
    );
    throw new ProofShotError(
      `Browser command failed: agent-browser ${command}\n${message || 'Unknown error'}`,
      error,
    );
  }
}

function readProcessOutput(error: unknown, key: 'stderr' | 'stdout'): string {
  if (typeof error !== 'object' || error === null || !(key in error)) {
    return '';
  }
  const output = (error as Record<'stderr' | 'stdout', unknown>)[key];
  return Buffer.isBuffer(output) ? output.toString() : String(output || '');
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
