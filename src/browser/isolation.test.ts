import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  findExecutablePath: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFileSync: mocks.execFileSync,
}));
vi.mock('../utils/process.js', () => ({
  findExecutablePath: mocks.findExecutablePath,
}));

import {
  getIsolatedAgentBrowserEnvironment,
  loadIsolatedAgentBrowserConfig,
  parseAgentBrowserVersion,
  resolveAgentBrowserRuntime,
  writeIsolatedAgentBrowserConfig,
} from './isolation.js';

const createdDirectories: string[] = [];

beforeEach(() => {
  mocks.execFileSync.mockReset();
  mocks.findExecutablePath.mockReset();
  mocks.findExecutablePath.mockReturnValue('/opt/node24/bin/agent-browser');
});

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('agent-browser isolation', () => {
  it('rejects inherited provider, connection, and persistent-state modes', () => {
    for (const key of [
      'AGENT_BROWSER_PROVIDER',
      'AGENT_BROWSER_CDP',
      'AGENT_BROWSER_AUTO_CONNECT',
      'AGENT_BROWSER_PROFILE',
      'AGENT_BROWSER_PLUGINS',
      'AGENT_BROWSER_STATE',
      'AGENT_BROWSER_SESSION_NAME',
    ]) {
      expect(() =>
        loadIsolatedAgentBrowserConfig(undefined, { [key]: 'configured' }),
      ).toThrow(key);
    }
  });

  it('rejects incompatible modes in an explicit config', () => {
    const directory = createDirectory();
    const configPath = path.join(directory, 'agent-browser.json');
    fs.writeFileSync(configPath, JSON.stringify({ profile: './shared-profile' }));

    expect(() =>
      loadIsolatedAgentBrowserConfig(configPath, {}),
    ).toThrow('config key "profile"');
  });

  it('rejects plugin loading from an explicit config', () => {
    const directory = createDirectory();
    const configPath = path.join(directory, 'agent-browser.json');
    fs.writeFileSync(configPath, JSON.stringify({ plugins: ['./plugin.js'] }));

    expect(() => loadIsolatedAgentBrowserConfig(configPath, {})).toThrow(
      'config key "plugins"',
    );
  });

  it('copies a safe config into private per-session state', () => {
    const directory = createDirectory();
    const sourcePath = path.join(directory, 'source.json');
    const privateDirectory = path.join(directory, 'private', 'agent-browser');
    fs.writeFileSync(
      sourcePath,
      JSON.stringify({ ignoreHttpsErrors: true, userAgent: 'proofshot-test' }),
    );

    const config = loadIsolatedAgentBrowserConfig(sourcePath, {});
    const configPath = writeIsolatedAgentBrowserConfig(privateDirectory, config);

    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8'))).toEqual(config);
    expect(fs.statSync(privateDirectory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('strips incompatible modes from every agent-browser subprocess', () => {
    const environment = getIsolatedAgentBrowserEnvironment({
      AGENT_BROWSER_PROVIDER: 'browserbase',
      AGENT_BROWSER_PROFILE: './shared',
      PATH: '/usr/bin',
    });

    expect(environment).toEqual({ PATH: '/usr/bin' });
  });

  it('parses the supported semantic version envelope', () => {
    expect(parseAgentBrowserVersion('agent-browser 0.34.0')).toEqual([0, 34, 0]);
    expect(parseAgentBrowserVersion('0.35.2')).toEqual([0, 35, 2]);
    expect(parseAgentBrowserVersion('unknown')).toBeNull();
  });

  it('resolves one executable and requires exactly agent-browser 0.34.0', () => {
    mocks.execFileSync.mockReturnValueOnce('agent-browser 0.33.1\n');
    expect(() => resolveAgentBrowserRuntime({ PATH: '/usr/bin' })).toThrow(
      'requires exactly agent-browser 0.34.0',
    );

    mocks.execFileSync.mockReturnValueOnce('agent-browser 0.35.0\n');
    expect(() => resolveAgentBrowserRuntime({ PATH: '/usr/bin' })).toThrow(
      'requires exactly agent-browser 0.34.0',
    );

    mocks.execFileSync.mockReturnValueOnce('agent-browser 0.34.0-beta.1\n');
    expect(() => resolveAgentBrowserRuntime({ PATH: '/usr/bin' })).toThrow(
      'requires exactly agent-browser 0.34.0',
    );

    mocks.execFileSync.mockReturnValueOnce('agent-browser 0.34.0\n');
    expect(resolveAgentBrowserRuntime({ PATH: '/usr/bin' })).toEqual({
      executablePath: '/opt/node24/bin/agent-browser',
      version: '0.34.0',
    });
    expect(mocks.execFileSync).toHaveBeenLastCalledWith(
      '/opt/node24/bin/agent-browser',
      ['--version'],
      expect.objectContaining({ env: { PATH: '/usr/bin' } }),
    );
  });

  it('normalizes a discovered executable to an absolute path before probing it', () => {
    mocks.findExecutablePath.mockReturnValue('./tools/agent-browser');
    mocks.execFileSync.mockReturnValueOnce('0.34.0\n');
    const executablePath = path.resolve('./tools/agent-browser');

    expect(resolveAgentBrowserRuntime({ PATH: './tools' })).toEqual({
      executablePath,
      version: '0.34.0',
    });
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      executablePath,
      ['--version'],
      expect.any(Object),
    );
  });

  it('fails before version probing when agent-browser is unavailable', () => {
    mocks.findExecutablePath.mockReturnValue(null);

    expect(() => resolveAgentBrowserRuntime({ PATH: '/usr/bin' })).toThrow(
      'agent-browser executable was not found',
    );
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });
});

function createDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-isolation-'));
  createdDirectories.push(directory);
  return directory;
}
