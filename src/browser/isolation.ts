import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
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
  'json',
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
  contract: AgentBrowserRuntimeContract;
  executablePath: string;
  entrypointSha256?: string;
  nativePath: string;
  nativeSha256: string;
  nodeVersion?: string;
  sha256: string;
  version: string;
};

export type AgentBrowserRuntimeContract =
  | 'direct-native-v1'
  | 'managed-preflight-v1'
  | 'npm-wrapper-v1';

export type AgentBrowserRuntimeReceipt = {
  contract: AgentBrowserRuntimeContract;
  entrypointSha256?: string;
  launcherSha256: string;
  nativeSha256: string;
  nodeVersion?: string;
  version: string;
};

export function resolveAgentBrowserRuntime(
  env: NodeJS.ProcessEnv = process.env,
): AgentBrowserRuntime {
  const discoveredExecutablePath = findExecutablePath('agent-browser');
  if (!discoveredExecutablePath) {
    throw new Error('agent-browser executable was not found on PATH.');
  }
  return resolveAgentBrowserRuntimeAtPath(discoveredExecutablePath, env);
}

export function assertAgentBrowserRuntime(
  expected: AgentBrowserRuntime,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const actual = resolveAgentBrowserRuntimeAtPath(expected.executablePath, env);
  if (
    actual.executablePath !== expected.executablePath ||
    actual.contract !== expected.contract ||
    actual.nativePath !== expected.nativePath ||
    actual.nativeSha256 !== expected.nativeSha256 ||
    actual.entrypointSha256 !== expected.entrypointSha256 ||
    actual.nodeVersion !== expected.nodeVersion ||
    actual.version !== expected.version ||
    actual.sha256 !== expected.sha256
  ) {
    throw new Error(
      'The pinned agent-browser executable changed after this ProofShot session started.',
    );
  }
}

export function resolveAgentBrowserRuntimeAtPath(
  discoveredExecutablePath: string,
  env: NodeJS.ProcessEnv = process.env,
): AgentBrowserRuntime {
  let executablePath: string;
  try {
    executablePath = fs.realpathSync(path.resolve(discoveredExecutablePath));
  } catch {
    throw new Error('The pinned agent-browser executable is no longer available.');
  }

  const environment = getIsolatedAgentBrowserEnvironment(env);
  const artifacts = resolveRuntimeArtifacts(executablePath, environment);
  const output = execFileSync(executablePath, ['--version'], {
    encoding: 'utf-8',
    env: environment,
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
    contract: artifacts.contract,
    executablePath,
    ...(artifacts.entrypointSha256
      ? { entrypointSha256: artifacts.entrypointSha256 }
      : {}),
    nativePath: artifacts.nativePath,
    nativeSha256: artifacts.nativeSha256,
    ...(artifacts.nodeVersion ? { nodeVersion: artifacts.nodeVersion } : {}),
    sha256: hashFile(executablePath),
    version: version.join('.'),
  };
}

export function toAgentBrowserRuntimeReceipt(
  runtime: AgentBrowserRuntime,
): AgentBrowserRuntimeReceipt {
  return {
    contract: runtime.contract,
    ...(runtime.entrypointSha256
      ? { entrypointSha256: runtime.entrypointSha256 }
      : {}),
    launcherSha256: runtime.sha256,
    nativeSha256: runtime.nativeSha256,
    ...(runtime.nodeVersion ? { nodeVersion: runtime.nodeVersion } : {}),
    version: runtime.version,
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

type RuntimeArtifacts = Pick<
  AgentBrowserRuntime,
  | 'contract'
  | 'entrypointSha256'
  | 'nativePath'
  | 'nativeSha256'
  | 'nodeVersion'
>;

type ManagedPreflightReport = {
  agentBrowserVersion: string;
  entrypointPath?: string;
  entrypointSha256?: string;
  nativePath: string;
  nativeSha256: string;
  nodeVersion?: string;
  result: string;
};

function resolveRuntimeArtifacts(
  executablePath: string,
  env: NodeJS.ProcessEnv,
): RuntimeArtifacts {
  const managed = readManagedPreflight(executablePath, env);
  if (managed) {
    return managed;
  }
  if (isNativeExecutable(executablePath)) {
    return {
      contract: 'direct-native-v1',
      nativePath: executablePath,
      nativeSha256: hashFile(executablePath),
    };
  }
  if (path.basename(executablePath) === 'agent-browser.js') {
    const nativePath = path.join(
      path.dirname(executablePath),
      resolveNpmNativeBinaryName(),
    );
    const canonicalNativePath = fs.realpathSync(nativePath);
    return {
      contract: 'npm-wrapper-v1',
      entrypointSha256: hashFile(executablePath),
      nativePath: canonicalNativePath,
      nativeSha256: hashFile(canonicalNativePath),
      nodeVersion: process.version,
    };
  }
  throw new Error(
    'agent-browser launcher does not expose a verifiable native runtime contract.',
  );
}

function readManagedPreflight(
  executablePath: string,
  env: NodeJS.ProcessEnv,
): RuntimeArtifacts | null {
  let output: string;
  try {
    output = execFileSync(executablePath, ['--managed-preflight'], {
      encoding: 'utf-8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }

  let report: ManagedPreflightReport;
  try {
    report = JSON.parse(output) as ManagedPreflightReport;
  } catch {
    throw new Error('agent-browser managed preflight returned invalid JSON.');
  }
  if (
    report.result !== 'ok' ||
    report.agentBrowserVersion !== REQUIRED_AGENT_BROWSER_VERSION ||
    typeof report.nativePath !== 'string' ||
    typeof report.nativeSha256 !== 'string'
  ) {
    throw new Error('agent-browser managed preflight contract is invalid.');
  }
  const nativePath = fs.realpathSync(report.nativePath);
  const nativeSha256 = hashFile(nativePath);
  if (nativeSha256 !== report.nativeSha256) {
    throw new Error('agent-browser native digest does not match its launcher contract.');
  }
  let entrypointSha256: string | undefined;
  if (report.entrypointPath || report.entrypointSha256) {
    if (
      typeof report.entrypointPath !== 'string' ||
      typeof report.entrypointSha256 !== 'string'
    ) {
      throw new Error('agent-browser entrypoint contract is incomplete.');
    }
    entrypointSha256 = hashFile(fs.realpathSync(report.entrypointPath));
    if (entrypointSha256 !== report.entrypointSha256) {
      throw new Error(
        'agent-browser entrypoint digest does not match its launcher contract.',
      );
    }
  }
  return {
    contract: 'managed-preflight-v1',
    entrypointSha256,
    nativePath,
    nativeSha256,
    nodeVersion: report.nodeVersion,
  };
}

function resolveNpmNativeBinaryName(): string {
  const architecture =
    process.arch === 'x64'
      ? 'x64'
      : process.arch === 'arm64'
        ? 'arm64'
        : null;
  if (!architecture) {
    throw new Error(`Unsupported agent-browser architecture: ${process.arch}.`);
  }
  if (process.platform === 'darwin') {
    return `agent-browser-darwin-${architecture}`;
  }
  if (process.platform === 'win32') {
    return `agent-browser-win32-${architecture}.exe`;
  }
  if (process.platform === 'linux') {
    const muslLoader = `/lib/ld-musl-${architecture === 'x64' ? 'x86_64' : 'aarch64'}.so.1`;
    const platform = fs.existsSync(muslLoader) ? 'linux-musl' : 'linux';
    return `agent-browser-${platform}-${architecture}`;
  }
  throw new Error(`Unsupported agent-browser platform: ${process.platform}.`);
}

function isNativeExecutable(filePath: string): boolean {
  const header = fs.readFileSync(filePath).subarray(0, 4);
  if (header.length < 2) {
    return false;
  }
  if (header[0] === 0x7f && header.subarray(1, 4).toString('ascii') === 'ELF') {
    return true;
  }
  if (header[0] === 0x4d && header[1] === 0x5a) {
    return true;
  }
  const magic = header.readUInt32BE(0);
  return [
    0xcafebabe,
    0xbebafeca,
    0xfeedface,
    0xcefaedfe,
    0xfeedfacf,
    0xcffaedfe,
  ].includes(magic);
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
