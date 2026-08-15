import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAgentBrowserCommand, setAgentBrowserDefaults } from './exec.js';

describe('buildAgentBrowserCommand', () => {
  beforeEach(() => {
    setAgentBrowserDefaults({
      executablePath: '/opt/node24/bin/agent-browser',
    });
  });

  afterEach(() => {
    setAgentBrowserDefaults({});
  });

  it('refuses commands before an executable is verified', () => {
    setAgentBrowserDefaults({});

    expect(() => buildAgentBrowserCommand('open http://localhost:3000')).toThrow(
      'agent-browser executable path has not been verified',
    );
  });

  it('prepends the configured session flag before the command', () => {
    expect(buildAgentBrowserCommand('snapshot -i', { session: 'proofshot-2026-04-07_22-30-00' })).toBe(
      "'/opt/node24/bin/agent-browser' --session 'proofshot-2026-04-07_22-30-00' snapshot -i",
    );
  });

  it('shell-quotes session names safely', () => {
    expect(buildAgentBrowserCommand('console', { session: "proofshot-o'connor" })).toBe(
      "'/opt/node24/bin/agent-browser' --session 'proofshot-o'\\''connor' console",
    );
  });

  it('prepends the configured agent-browser config path before the command', () => {
    expect(buildAgentBrowserCommand('open http://localhost:3000', { configPath: '/tmp/agent-browser.json' })).toBe(
      "'/opt/node24/bin/agent-browser' --config '/tmp/agent-browser.json' open http://localhost:3000",
    );
  });

  it('applies default config path options to later commands', () => {
    setAgentBrowserDefaults({
      configPath: '/tmp/project-agent-browser.json',
      executablePath: '/opt/node24/bin/agent-browser',
    });

    expect(buildAgentBrowserCommand('snapshot -i')).toBe(
      "'/opt/node24/bin/agent-browser' --config '/tmp/project-agent-browser.json' snapshot -i",
    );
  });

  it('executes the exact verified agent-browser path for later commands', () => {
    setAgentBrowserDefaults({
      executablePath: '/opt/node 24/bin/agent-browser',
    });

    expect(buildAgentBrowserCommand('snapshot -i')).toBe(
      "'/opt/node 24/bin/agent-browser' snapshot -i",
    );
  });
});
