import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setAgentBrowserDefaults } from '../utils/exec.js';
import {
  assertControlledAgentBrowserCommand,
  buildExecInvocation,
  prepareControlledAgentBrowserCommand,
  translateProofShotExecArgs,
} from './exec.js';

describe('buildExecInvocation', () => {
  beforeEach(() => {
    setAgentBrowserDefaults({
      executablePath: '/opt/node24/bin/agent-browser',
    });
  });

  afterEach(() => {
    setAgentBrowserDefaults({});
  });

  it('routes regular commands through the active ProofShot session', () => {
    expect(buildExecInvocation(['click', '@e2'], 'proofshot-2026-04-07_22-30-00')).toEqual({
      executablePath: '/opt/node24/bin/agent-browser',
      args: [
        '--session',
        'proofshot-2026-04-07_22-30-00',
        'click',
        '@e2',
      ],
    });
  });

  it('preserves eval source as one argument while adding the session flag', () => {
    expect(buildExecInvocation(['eval', "console.log('hello')"], 'proofshot-dev')).toEqual({
      executablePath: '/opt/node24/bin/agent-browser',
      args: [
        '--session',
        'proofshot-dev',
        'eval',
        "console.log('hello')",
      ],
    });
  });

  it('preserves regular arguments that contain shell metacharacters', () => {
    expect(buildExecInvocation(['screenshot', 'step $(touch nope); (1).png'], 'proofshot-dev')).toEqual({
      executablePath: '/opt/node24/bin/agent-browser',
      args: [
        '--session',
        'proofshot-dev',
        'screenshot',
        'step $(touch nope); (1).png',
      ],
    });
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
      ['chat', 'inspect the page'],
      ['clipboard', 'read'],
      ['close'],
      ['connect', '9222'],
      ['dashboard', 'start'],
      ['doctor', '--fix'],
      ['download', '@e1', '/tmp/report.csv'],
      ['install'],
      ['pdf', '/tmp/page.pdf'],
      ['profiles'],
      ['pushstate', 'https://example.com/private'],
      ['record', 'stop'],
      ['session', 'list'],
      ['state', 'load', './shared.json'],
      ['stream', 'enable', '--port', '4848'],
      ['trace', 'stop', '/tmp/trace.zip'],
      ['upgrade'],
      ['future-command', 'value'],
    ]) {
      expect(() => assertControlledAgentBrowserCommand(args)).toThrow(
        /not permitted|cannot override browser state/,
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
    expect(() =>
      assertControlledAgentBrowserCommand([
        'batch',
        'snapshot -i',
        'dashboard start --port 4848',
      ]),
    ).toThrow('dashboard is not permitted');
    expect(() =>
      assertControlledAgentBrowserCommand([
        'batch',
        'snapshot -i',
        'screenshot /tmp/outside.png',
      ]),
    ).toThrow('screenshot must run as a separate ProofShot action');
  });

  it.each([
    ['get', 'cdp-url'],
    ['network', 'har', 'stop'],
    ['network', 'request', '1234.5'],
    ['network', 'requests', '--clear'],
    ['network', 'route', '**/api/*', '--abort'],
    ['console', '--clear'],
    ['console', '--future-option'],
    ['cookies', 'import', './shared.json'],
    ['errors', '--clear'],
    ['keyboard', 'paste', 'private'],
    ['mouse', 'teleport', '1', '2'],
    ['set', 'profile', 'shared'],
    ['storage', 'indexeddb', 'get'],
    ['storage', 'local', 'export'],
  ])('rejects unsupported or evidence-destructive subcommands: %j', (...args) => {
    expect(() => assertControlledAgentBrowserCommand(args)).toThrow(
      /not permitted|owned by ProofShot/,
    );
  });

  it('requires screenshots to use one PNG filename in the session root', () => {
    expect(
      prepareControlledAgentBrowserCommand(
        ['screenshot', '--full', 'step (1).png'],
        '/evidence/session',
      ),
    ).toEqual([
      'screenshot',
      '/evidence/session/step (1).png',
      '--full',
    ]);

    for (const args of [
      ['screenshot'],
      ['screenshot', '--annotate'],
      ['screenshot', '../outside.png'],
      ['screenshot', '/tmp/outside.png'],
      ['screenshot', 'step.jpg'],
      ['screenshot', '--screenshot-dir', '/tmp'],
    ]) {
      expect(() =>
        prepareControlledAgentBrowserCommand(args, '/evidence/session'),
      ).toThrow(/PNG filename directly inside/);
    }
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
    expect(() =>
      assertControlledAgentBrowserCommand(['keyboard', 'type', 'hello']),
    ).not.toThrow();
    expect(() =>
      assertControlledAgentBrowserCommand(['set', 'viewport', '1280', '720']),
    ).not.toThrow();
    expect(() =>
      assertControlledAgentBrowserCommand([
        'storage',
        'local',
        'set',
        'theme',
        'dark',
      ]),
    ).not.toThrow();
  });
});
