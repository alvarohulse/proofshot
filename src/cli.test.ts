import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCLI } from './cli.js';

const mocks = vi.hoisted(() => ({
  execCommand: vi.fn(),
}));

vi.mock('./commands/exec.js', () => ({
  execCommand: mocks.execCommand,
}));

describe('CLI', () => {
  afterEach(() => {
    mocks.execCommand.mockReset();
  });

  it('keeps agent-browser options after the first passthrough argument', async () => {
    const cli = createCLI();
    cli.exitOverride();

    await cli.parseAsync([
      'node',
      'proofshot',
      'exec',
      '--session',
      'proofshot-test',
      'snapshot',
      '--session',
      'agent-browser-session',
    ]);

    expect(mocks.execCommand).toHaveBeenCalledWith(
      ['snapshot', '--session', 'agent-browser-session'],
      expect.objectContaining({ session: 'proofshot-test' }),
    );
  });
});
