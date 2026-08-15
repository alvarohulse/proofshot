import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { findExecutablePath } from '../utils/process.js';

const REQUIRED_AGENT_BROWSER_VERSION = '0.34.0';
const REQUIRED_AGENT_BROWSER_VERSION_OUTPUT = /^(?:agent-browser\s+)?0\.34\.0$/i;
const INCOMPATIBLE_ENVIRONMENT_KEYS = [
  'AGENT_BROWSER_ARGS',
  'AGENT_BROWSER_AUTO_CONNECT',
  'AGENT_BROWSER_CDP',
  'AGENT_BROWSER_CONFIG',
  'AGENT_BROWSER_ENGINE',
  'AGENT_BROWSER_EXTENSIONS',
  'AGENT_BROWSER_INIT_SCRIPTS',
  'AGENT_BROWSER_PLUGINS',
  'AGENT_BROWSER_PROFILE',
  'AGENT_BROWSER_PROVIDER',
  'AGENT_BROWSER_PROXY',
  'AGENT_BROWSER_PROXY_BYPASS',
  'AGENT_BROWSER_SESSION',
  'AGENT_BROWSER_SESSION_NAME',
  'AGENT_BROWSER_STATE',
] as const;
const INCOMPATIBLE_CONFIG_KEYS = new Set([
  'allowfileaccess',
  'args',
  'autoconnect',
  'cdp',
  'enable',
  'engine',
  'extensions',
  'headers',
  'headed',
  'initscript',
  'initscripts',
  'profile',
  'plugins',
  'provider',
  'proxy',
  'proxybypass',
  'session',
  'sessionname',
  'state',
]);

export function loadIsolatedAgentBrowserConfig(
  sourcePath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  assertIsolatedAgentBrowserEnvironment(env);
  if (!sourcePath) {
    return {};
  }
  const value = JSON.parse(fs.readFileSync(sourcePath, 'utf-8')) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`agent-browser config must contain a JSON object: ${sourcePath}`);
  }
  const config = value as Record<string, unknown>;
  const incompatibleKey = Object.keys(config).find((key) =>
    INCOMPATIBLE_CONFIG_KEYS.has(normalizeConfigKey(key)),
  );
  if (incompatibleKey) {
    throw new Error(
      `agent-browser config key "${incompatibleKey}" is incompatible with an isolated local ProofShot browser.`,
    );
  }
  return config;
}

export function writeIsolatedAgentBrowserConfig(
  privateDirectory: string,
  config: Record<string, unknown>,
): string {
  fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDirectory, 0o700);
  const configPath = path.join(privateDirectory, 'config.json');
  const temporaryPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2) + '\n', {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, configPath);
    fs.chmodSync(configPath, 0o600);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
  return configPath;
}

export type AgentBrowserRuntime = {
  executablePath: string;
  version: string;
};

export function resolveAgentBrowserRuntime(
  env: NodeJS.ProcessEnv = process.env,
): AgentBrowserRuntime {
  const discoveredExecutablePath = findExecutablePath('agent-browser');
  if (!discoveredExecutablePath) {
    throw new Error('agent-browser executable was not found on PATH.');
  }
  const executablePath = path.resolve(discoveredExecutablePath);

  const output = execFileSync(executablePath, ['--version'], {
    encoding: 'utf-8',
    env: getIsolatedAgentBrowserEnvironment(env),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  }).trim();
  const version = parseAgentBrowserVersion(output);
  if (
    !version ||
    version.join('.') !== REQUIRED_AGENT_BROWSER_VERSION ||
    !REQUIRED_AGENT_BROWSER_VERSION_OUTPUT.test(output)
  ) {
    throw new Error(
      `ProofShot requires exactly agent-browser ${REQUIRED_AGENT_BROWSER_VERSION}; received ${output || 'no version output'}.`,
    );
  }
  return {
    executablePath,
    version: version.join('.'),
  };
}

export function getIsolatedAgentBrowserEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const isolatedEnvironment = { ...env };
  for (const key of INCOMPATIBLE_ENVIRONMENT_KEYS) {
    delete isolatedEnvironment[key];
  }
  return isolatedEnvironment;
}

export function parseAgentBrowserVersion(
  output: string,
): readonly [number, number, number] | null {
  const match = output.match(/(?:agent-browser\s+)?(\d+)\.(\d+)\.(\d+)/i);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : null;
}

function assertIsolatedAgentBrowserEnvironment(env: NodeJS.ProcessEnv): void {
  const incompatibleKey = INCOMPATIBLE_ENVIRONMENT_KEYS.find(
    (key) => env[key] !== undefined && env[key] !== '',
  );
  if (incompatibleKey) {
    throw new Error(
      `${incompatibleKey} is incompatible with an isolated local ProofShot browser.`,
    );
  }
}

function normalizeConfigKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}
