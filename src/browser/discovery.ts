import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findExecutablePath } from '../utils/process.js';

export interface BrowserDiscoveryOptions {
  configuredPath?: string;
  env?: NodeJS.ProcessEnv;
  accountHome?: string;
  platform?: NodeJS.Platform;
  findExecutable?: typeof findExecutablePath;
}

function isExecutable(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(filePath, fs.constants.R_OK | fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function sortedDirectories(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function cachedBrowserCandidates(home: string): string[] {
  const candidates: string[] = [];
  const agentBrowserRoot = path.join(home, '.agent-browser', 'browsers');
  for (const directory of sortedDirectories(agentBrowserRoot)) {
    candidates.push(
      path.join(agentBrowserRoot, directory, 'chrome'),
      path.join(agentBrowserRoot, directory, 'chrome-linux64', 'chrome'),
      path.join(agentBrowserRoot, directory, 'chrome-linux', 'chrome'),
    );
  }

  const playwrightRoot = path.join(home, '.cache', 'ms-playwright');
  for (const directory of sortedDirectories(playwrightRoot)) {
    if (!directory.startsWith('chromium')) continue;
    candidates.push(
      path.join(playwrightRoot, directory, 'chrome-linux64', 'chrome'),
      path.join(playwrightRoot, directory, 'chrome-linux', 'chrome'),
      path.join(playwrightRoot, directory, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    );
  }

  const puppeteerRoot = path.join(home, '.cache', 'puppeteer', 'chrome');
  for (const directory of sortedDirectories(puppeteerRoot)) {
    candidates.push(
      path.join(puppeteerRoot, directory, 'chrome-linux64', 'chrome'),
      path.join(puppeteerRoot, directory, 'chrome-linux', 'chrome'),
    );
  }
  return candidates;
}

function accountHomeDirectory(): string | undefined {
  try {
    return os.userInfo().homedir;
  } catch {
    return undefined;
  }
}

/**
 * Find a Chrome/Chromium executable without assuming that `$HOME` is the
 * account's real home directory. No profile, cookies, or storage are reused.
 */
export function discoverBrowserExecutable(
  options: BrowserDiscoveryOptions = {},
): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const executableLookup = options.findExecutable ?? findExecutablePath;
  const explicit = options.configuredPath || env.AGENT_BROWSER_EXECUTABLE_PATH;

  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!isExecutable(resolved)) {
      throw new Error(
        `Browser executable is not runnable: ${resolved}\n` +
          `Retry with: proofshot start --browser-executable ${JSON.stringify(resolved)}`,
      );
    }
    return resolved;
  }

  const commandNames =
    platform === 'darwin'
      ? ['google-chrome', 'chromium']
      : platform === 'win32'
        ? ['chrome', 'msedge']
        : ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'];
  for (const command of commandNames) {
    const executable = executableLookup(command, platform);
    if (executable && isExecutable(executable)) return executable;
  }

  const homes = new Set<string>();
  if (env.HOME) homes.add(path.resolve(env.HOME));
  const accountHome = options.accountHome ?? accountHomeDirectory();
  if (accountHome) homes.add(path.resolve(accountHome));

  const candidates: string[] = [];
  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else if (platform === 'win32') {
    for (const root of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]) {
      if (!root) continue;
      candidates.push(
        path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      );
    }
  } else {
    for (const home of homes) candidates.push(...cachedBrowserCandidates(home));
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }

  return candidates.find(isExecutable) ?? null;
}

export function browserSetupError(): Error {
  return new Error(
    'No runnable Chrome/Chromium executable was found for this environment.\n' +
      'Run `agent-browser install` in this environment, then retry `proofshot start`.',
  );
}
