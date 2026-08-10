import * as fs from 'fs';
import * as path from 'path';
import type {
  EnvironmentConfig,
  LogsConfig,
  LogSourceConfig,
} from '../environment/types.js';

export interface DevServerConfig {
  port: number;
  startupTimeout: number;
}

export interface ViewportConfig {
  width: number;
  height: number;
}

export interface BrowserConfig {
  configPath?: string;
  executablePath?: string;
  ignoreHttpsErrors: boolean;
}

export interface ProofShotConfig {
  devServer: DevServerConfig;
  output: string;
  defaultPages: string[];
  viewport: ViewportConfig;
  headless: boolean;
  browser: BrowserConfig;
  environment?: EnvironmentConfig;
  logs: LogsConfig;
}

const CONFIG_FILENAME = 'proofshot.config.json';

const DEFAULT_CONFIG: ProofShotConfig = {
  devServer: {
    port: 3000,
    startupTimeout: 30000,
  },
  output: './proofshot-artifacts',
  defaultPages: ['/'],
  viewport: { width: 1280, height: 720 },
  headless: true,
  browser: {
    ignoreHttpsErrors: false,
  },
  logs: {
    stripAnsi: true,
    maxBytesPerSource: 5 * 1024 * 1024,
    sources: [],
  },
};

/**
 * Find the config file by walking up from cwd.
 */
export function findConfigPath(startDir?: string): string | null {
  let dir = startDir || process.cwd();
  while (true) {
    const configPath = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(configPath)) return configPath;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Load config from disk, merging with defaults.
 */
export function loadConfig(startDir?: string): ProofShotConfig {
  const configPath = findConfigPath(startDir);
  if (!configPath) return { ...DEFAULT_CONFIG };

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    validateConfig(parsed);
    const configDir = path.dirname(configPath);
    const resolvedBrowser = {
      ...DEFAULT_CONFIG.browser,
      ...parsed.browser,
    };
    if (resolvedBrowser.configPath) {
      resolvedBrowser.configPath = path.resolve(configDir, resolvedBrowser.configPath);
    }
    const environment = resolveEnvironmentConfig(parsed.environment, configDir);
    const logs = resolveLogsConfig(parsed.logs, configDir);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      output: path.resolve(
        configDir,
        typeof parsed.output === 'string' ? parsed.output : DEFAULT_CONFIG.output,
      ),
      devServer: { ...DEFAULT_CONFIG.devServer, ...parsed.devServer },
      viewport: { ...DEFAULT_CONFIG.viewport, ...parsed.viewport },
      browser: resolvedBrowser,
      environment,
      logs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ProofShot config at ${configPath}: ${message}`);
  }
}

function validateConfig(value: unknown): void {
  assertRecord(value, 'config');
  assertOptionalString(value.output, 'output');
  assertOptionalBoolean(value.headless, 'headless');
  assertOptionalStringArray(value.defaultPages, 'defaultPages');

  if (value.devServer !== undefined) {
    assertRecord(value.devServer, 'devServer');
    assertOptionalPositiveInteger(value.devServer.port, 'devServer.port', 65535);
    assertOptionalPositiveInteger(
      value.devServer.startupTimeout,
      'devServer.startupTimeout',
    );
  }
  if (value.viewport !== undefined) {
    assertRecord(value.viewport, 'viewport');
    assertOptionalPositiveInteger(value.viewport.width, 'viewport.width');
    assertOptionalPositiveInteger(value.viewport.height, 'viewport.height');
  }
  if (value.browser !== undefined) {
    assertRecord(value.browser, 'browser');
    assertOptionalString(value.browser.configPath, 'browser.configPath');
    assertOptionalString(value.browser.executablePath, 'browser.executablePath');
    assertOptionalBoolean(value.browser.ignoreHttpsErrors, 'browser.ignoreHttpsErrors');
  }
  validateEnvironment(value.environment);
  validateLogs(value.logs);
}

function validateEnvironment(value: unknown): void {
  if (value === undefined) return;
  assertRecord(value, 'environment');
  validateReadiness(value.readiness);

  if (value.kind === 'tmux') {
    assertRecord(value.launch, 'environment.launch');
    assertOptionalString(value.cwd, 'environment.cwd');
    if (value.launch.kind === 'panes') {
      if (!Array.isArray(value.launch.panes) || value.launch.panes.length === 0) {
        throw new Error('environment.launch.panes must be a non-empty array');
      }
      validateDefinitions(value.launch.panes, 'environment.launch.panes');
      assertOptionalString(
        value.launch.sessionName,
        'environment.launch.sessionName',
      );
      if (value.connection !== undefined) {
        throw new Error('environment.connection is only valid for external-command');
      }
      return;
    }
    if (value.launch.kind === 'external-command') {
      assertNonEmptyString(value.launch.command, 'environment.launch.command');
      assertOptionalString(
        value.launch.stopCommand,
        'environment.launch.stopCommand',
      );
      assertOptionalPositiveInteger(
        value.launch.timeoutMs,
        'environment.launch.timeoutMs',
      );
      assertRecord(value.connection, 'environment.connection');
      if (
        value.connection.format !== 'json' &&
        value.connection.format !== 'tmux-attach-command'
      ) {
        throw new Error(
          'environment.connection.format must be "json" or "tmux-attach-command"',
        );
      }
      if (
        value.connection.source !== undefined &&
        value.connection.source !== 'stdout'
      ) {
        throw new Error('environment.connection.source must be "stdout"');
      }
      assertOptionalString(value.connection.socket, 'environment.connection.socket');
      if (
        value.connection.ownership !== undefined &&
        value.connection.ownership !== 'attach' &&
        value.connection.ownership !== 'create'
      ) {
        throw new Error(
          'environment.connection.ownership must be "attach" or "create"',
        );
      }
      if (
        value.connection.ownership !== 'attach' &&
        value.connection.socket === undefined &&
        value.launch.stopCommand === undefined
      ) {
        throw new Error(
          'external-command requires connection.socket or launch.stopCommand for cleanup',
        );
      }
      return;
    }
    throw new Error(
      'environment.launch.kind must be "panes" or "external-command"',
    );
  }

  if (value.kind === 'processes') {
    if (!Array.isArray(value.commands)) {
      throw new Error('environment.commands must be an array');
    }
    validateDefinitions(value.commands, 'environment.commands');
    return;
  }
  throw new Error('environment.kind must be "tmux" or "processes"');
}

function validateDefinitions(value: unknown[], field: string): void {
  const ids = new Set<string>();
  value.forEach((candidate, index) => {
    const item = `${field}[${index}]`;
    assertRecord(candidate, item);
    assertSafeId(candidate.id, `${item}.id`);
    if (ids.has(candidate.id)) throw new Error(`Duplicate ${field} id: ${candidate.id}`);
    ids.add(candidate.id);
    assertNonEmptyString(candidate.command, `${item}.command`);
    assertOptionalString(candidate.title, `${item}.title`);
    assertOptionalString(candidate.group, `${item}.group`);
    assertOptionalString(candidate.cwd, `${item}.cwd`);
    if (candidate.env !== undefined) {
      assertRecord(candidate.env, `${item}.env`);
      for (const [key, envValue] of Object.entries(candidate.env)) {
        if (typeof envValue !== 'string') {
          throw new Error(`${item}.env.${key} must be a string`);
        }
      }
    }
  });
}

function validateReadiness(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error('environment.readiness must be an array');
  value.forEach((candidate, index) => {
    const item = `environment.readiness[${index}]`;
    assertRecord(candidate, item);
    assertOptionalPositiveInteger(candidate.timeoutMs, `${item}.timeoutMs`);
    if (candidate.kind === 'http') {
      assertNonEmptyString(candidate.url, `${item}.url`);
      return;
    }
    if (candidate.kind === 'tcp') {
      assertOptionalString(candidate.host, `${item}.host`);
      assertOptionalPositiveInteger(candidate.port, `${item}.port`, 65535, true);
      return;
    }
    throw new Error(`${item}.kind must be "http" or "tcp"`);
  });
}

function validateLogs(value: unknown): void {
  if (value === undefined) return;
  assertRecord(value, 'logs');
  assertOptionalBoolean(value.stripAnsi, 'logs.stripAnsi');
  assertOptionalPositiveInteger(value.maxBytesPerSource, 'logs.maxBytesPerSource');
  if (
    value.maxBytesPerSource !== undefined &&
    value.maxBytesPerSource < 512
  ) {
    throw new Error('logs.maxBytesPerSource must be at least 512 bytes');
  }
  if (value.sources === undefined) return;
  if (!Array.isArray(value.sources)) throw new Error('logs.sources must be an array');

  const ids = new Set<string>();
  value.sources.forEach((candidate, index) => {
    const item = `logs.sources[${index}]`;
    assertRecord(candidate, item);
    assertSafeId(candidate.id, `${item}.id`);
    if (ids.has(candidate.id)) throw new Error(`Duplicate log source id: ${candidate.id}`);
    ids.add(candidate.id);
    assertOptionalString(candidate.title, `${item}.title`);
    assertOptionalString(candidate.group, `${item}.group`);
    assertOptionalStringArray(candidate.include, `${item}.include`);
    assertOptionalStringArray(candidate.exclude, `${item}.exclude`);

    if (candidate.kind === 'tmux-pane') {
      assertRecord(candidate.match, `${item}.match`);
      const keys = ['connectionKey', 'tag', 'target'].filter(
        (key) => candidate.match[key] !== undefined,
      );
      if (keys.length !== 1) {
        throw new Error(`${item}.match must set exactly one pane selector`);
      }
      assertNonEmptyString(candidate.match[keys[0]], `${item}.match.${keys[0]}`);
      return;
    }
    if (candidate.kind === 'process') {
      assertSafeId(candidate.processId, `${item}.processId`);
      return;
    }
    if (candidate.kind === 'file') {
      assertNonEmptyString(candidate.path, `${item}.path`);
      return;
    }
    throw new Error(`${item}.kind is unsupported`);
  });
}

function assertRecord(
  value: unknown,
  field: string,
): asserts value is Record<string, any> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
}

function assertSafeId(value: unknown, field: string): asserts value is string {
  assertNonEmptyString(value, field);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) {
    throw new Error(`${field} must contain only letters, numbers, "_" or "-"`);
  }
}

function assertNonEmptyString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertOptionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
}

function assertOptionalBoolean(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }
}

function assertOptionalStringArray(value: unknown, field: string): void {
  if (
    value !== undefined &&
    (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
  ) {
    throw new Error(`${field} must be an array of strings`);
  }
}

function assertOptionalPositiveInteger(
  value: unknown,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
  required = false,
): void {
  if (value === undefined && !required) return;
  if (
    !Number.isInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > maximum
  ) {
    throw new Error(`${field} must be a positive integer no greater than ${maximum}`);
  }
}

function resolveEnvironmentConfig(
  value: unknown,
  configDir: string,
): EnvironmentConfig | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const environment = value as EnvironmentConfig;
  if (environment.kind === 'tmux') {
    const launch =
      environment.launch.kind === 'panes'
        ? {
            ...environment.launch,
            panes: environment.launch.panes.map((pane) => ({
              ...pane,
              cwd: path.resolve(configDir, pane.cwd || environment.cwd || '.'),
            })),
          }
        : environment.launch;
    return {
      ...environment,
      cwd: path.resolve(configDir, environment.cwd || '.'),
      connection: environment.connection?.socket
        ? {
            ...environment.connection,
            socket: path.resolve(configDir, environment.connection.socket),
          }
        : environment.connection,
      launch,
    };
  }
  if (environment.kind === 'processes') {
    return {
      ...environment,
      commands: environment.commands.map((command) => ({
        ...command,
        cwd: path.resolve(configDir, command.cwd || '.'),
      })),
    };
  }
  return undefined;
}

function resolveLogsConfig(value: unknown, configDir: string): LogsConfig {
  const logs =
    typeof value === 'object' && value !== null
      ? (value as LogsConfig)
      : DEFAULT_CONFIG.logs;
  const sources: LogSourceConfig[] = (logs.sources || []).map((source) =>
    source.kind === 'file'
      ? { ...source, path: path.resolve(configDir, source.path) }
      : source,
  );
  return {
    ...DEFAULT_CONFIG.logs,
    ...logs,
    sources,
  };
}

/**
 * Write config to disk.
 */
export function writeConfig(
  config: ProofShotConfig,
  dir?: string,
): string {
  const configPath = path.join(dir || process.cwd(), CONFIG_FILENAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return configPath;
}

/**
 * Check if a config file exists in the current project.
 */
export function configExists(dir?: string): boolean {
  return findConfigPath(dir) !== null;
}
