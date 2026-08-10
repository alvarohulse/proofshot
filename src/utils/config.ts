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
  } catch {
    return { ...DEFAULT_CONFIG };
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
