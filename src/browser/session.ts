import {
  ab,
  ProofShotError,
} from '../utils/exec.js';
import type { BrowserConfig, ViewportConfig } from '../utils/config.js';

export function buildOpenBrowserCommand(
  url: string,
  headless = true,
  browserConfig?: BrowserConfig,
): string[] {
  const args = ['open', url];

  if (!headless) args.push('--headed');
  if (browserConfig?.ignoreHttpsErrors) args.push('--ignore-https-errors');
  if (browserConfig?.executablePath) {
    args.push('--executable-path', browserConfig.executablePath);
  }

  return args;
}

/**
 * Initialize a browser session.
 * Opens the browser and sets viewport dimensions.
 */
export function openBrowser(
  url: string,
  viewport: ViewportConfig,
  headless = true,
  sessionName?: string,
  browserConfig?: BrowserConfig,
): void {
  try {
    ab(buildOpenBrowserCommand(url, headless, browserConfig), {
      timeoutMs: 60000,
      session: sessionName,
    });
  } catch (error) {
    const currentUrl = getPageUrl(sessionName);
    if (!isNavigationTimeout(error) || !urlsMatch(currentUrl, url)) {
      throw error;
    }
    console.warn(
      'Browser reached the target URL before its load event timed out; continuing with the active page.',
    );
  }
  ab(['set', 'viewport', String(viewport.width), String(viewport.height)], {
    session: sessionName,
  });
}

function isNavigationTimeout(error: unknown): boolean {
  return (
    error instanceof ProofShotError &&
    error.message.toLowerCase().includes('operation timed out')
  );
}

function urlsMatch(actual: string, expected: string): boolean {
  try {
    return new URL(actual).href === new URL(expected).href;
  } catch {
    return actual === expected;
  }
}

/**
 * Close the browser session.
 */
export function closeBrowser(sessionName?: string): void {
  ab(['close'], { session: sessionName });
}

/**
 * Check if agent-browser is installed and accessible.
 */
export function checkAgentBrowser(): boolean {
  try {
    ab(['--version'], 5000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get any console errors from the current page.
 */
export function getConsoleErrors(sessionName?: string): string {
  return ab(['errors'], { session: sessionName });
}

/**
 * Get console output from the current page.
 */
export function getConsoleOutput(sessionName?: string): string {
  return ab(['console'], { session: sessionName });
}

export interface ConsoleMessage {
  text: string;
  timestamp: number; // epoch ms
  type: string; // log, warn, error, etc.
}

/**
 * Get console output as structured JSON with per-message timestamps.
 */
export function getConsoleOutputJson(sessionName?: string): ConsoleMessage[] {
  const raw = ab(['console', '--json'], { session: sessionName });
  const parsed = JSON.parse(raw);
  // agent-browser wraps JSON output: {success, data: {messages: [...]}, error}
  const messages = parsed?.data?.messages ?? parsed;
  if (!Array.isArray(messages)) {
    throw new Error('agent-browser returned malformed console JSON.');
  }
  return messages;
}

/**
 * Get the current page title.
 */
export function getPageTitle(sessionName?: string): string {
  try {
    return ab(['get', 'title'], { session: sessionName });
  } catch {
    return '';
  }
}

/**
 * Get the current page URL.
 */
export function getPageUrl(sessionName?: string): string {
  try {
    return ab(['get', 'url'], { session: sessionName });
  } catch {
    return '';
  }
}
