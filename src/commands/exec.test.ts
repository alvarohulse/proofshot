import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setAgentBrowserDefaults } from '../utils/exec.js';
import {
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
});
