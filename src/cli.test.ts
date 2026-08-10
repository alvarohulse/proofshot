import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prCommand: vi.fn(),
}));

vi.mock('./commands/pr.js', () => ({
  prCommand: mocks.prCommand,
}));

import { createCLI } from './cli.js';

describe('pr CLI selection options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts space-separated and repeated screenshot selectors', async () => {
    await createCLI().parseAsync(
      [
        'node',
        'proofshot',
        'pr',
        '42',
        '--session',
        'checkout',
        '--session',
        'settings',
        '--screenshot',
        'checkout/first.png',
        'settings/first.png',
        '--screenshot',
        'settings/second.png',
      ],
      { from: 'node' },
    );

    expect(mocks.prCommand).toHaveBeenCalledWith({
      prNumber: '42',
      dryRun: undefined,
      session: ['checkout', 'settings'],
      screenshot: [
        'checkout/first.png',
        'settings/first.png',
        'settings/second.png',
      ],
      legacySession: undefined,
      uploadProvider: 'repo-contents',
      artifactsBranch: 'proofshot-artifacts',
    });
  });
});
