import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setAgentBrowserDefaults } from '../utils/exec.js';
import {
  assertControlledAgentBrowserCommand,
  buildShellCommand,
  translateProofShotExecArgs,
} from './exec.js';

describe('buildShellCommand', () => {
  beforeEach(() => {
    setAgentBrowserDefaults({
      executablePath: '/opt/node24/bin/agent-browser',
    });
  });

  afterEach(() => {
    setAgentBrowserDefaults({});
  });

  it('routes regular commands through the active ProofShot session', () => {
    expect(buildShellCommand(['click', '@e2'], 'proofshot-2026-04-07_22-30-00')).toBe(
      "'/opt/node24/bin/agent-browser' --session 'proofshot-2026-04-07_22-30-00' click @e2",
    );
  });

  it('preserves eval shell quoting while adding the session flag', () => {
    expect(buildShellCommand(['eval', "console.log('hello')"], 'proofshot-dev')).toBe(
      "'/opt/node24/bin/agent-browser' --session 'proofshot-dev' eval 'console.log('\\''hello'\\'')'",
    );
  });

  it('quotes regular arguments that contain shell metacharacters', () => {
    expect(buildShellCommand(['screenshot', 'step (1).png'], 'proofshot-dev')).toBe(
      "'/opt/node24/bin/agent-browser' --session 'proofshot-dev' screenshot 'step (1).png'",
    );
  });

  it('translates visible-selector assertions into an evidence-bearing browser query', () => {
    expect(
      translateProofShotExecArgs(['assert-visible', '#ready']),
    ).toEqual({
      agentBrowserArgs: ['is', 'visible', '#ready'],
      expectedSelector: '#ready',
    });
  });

  it.each([
    ['snapshot', '--session=another-session'],
    ['open', 'https://example.com', '--allowed-domains=attacker.invalid'],
    ['open', 'https://example.com', '--provider', 'browserbase'],
    ['open', 'https://example.com', '--cdp=9222'],
    ['open', 'https://example.com', '--profile', './shared-profile'],
    ['open', 'https://example.com', '--state=./shared-state.json'],
    ['open', 'https://example.com', '--config', './untrusted.json'],
    ['open', 'https://example.com', '--executable-path=/tmp/browser'],
    ['open', 'https://example.com', '--namespace=shared'],
  ])('rejects ProofShot-owned global options: %j', (...args) => {
    expect(() => assertControlledAgentBrowserCommand(args)).toThrow(
      'owned by ProofShot',
    );
  });

  it('rejects commands that can escape the owned browser lifecycle', () => {
    for (const args of [
      ['auth', 'login', 'shared'],
      ['close'],
      ['connect', '9222'],
      ['record', 'stop'],
      ['state', 'load', './shared.json'],
    ]) {
      expect(() => assertControlledAgentBrowserCommand(args)).toThrow(
        'cannot override ProofShot-owned browser state',
      );
    }
    expect(() =>
      assertControlledAgentBrowserCommand(['network', 'har', 'stop']),
    ).toThrow('HAR capture is owned by ProofShot');
    expect(() =>
      assertControlledAgentBrowserCommand([
        'batch',
        'snapshot -i',
        'open https://example.com --provider browserbase',
      ]),
    ).toThrow('--provider is owned by ProofShot');
  });

  it('preserves legitimate command-specific options', () => {
    expect(() =>
      assertControlledAgentBrowserCommand(['snapshot', '-i', '--depth', '3']),
    ).not.toThrow();
    expect(() =>
      assertControlledAgentBrowserCommand([
        'find',
        'role',
        'button',
        'click',
        '--name',
        'Submit',
      ]),
    ).not.toThrow();
    expect(() =>
      assertControlledAgentBrowserCommand([
        'open',
        'https://example.com',
        '--headers',
        '{"X-Test":"proof"}',
      ]),
    ).not.toThrow();
    expect(() =>
      assertControlledAgentBrowserCommand(['network', 'requests']),
    ).not.toThrow();
  });
});
