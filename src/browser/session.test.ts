import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProofShotError } from '../utils/exec.js';
import { buildOpenBrowserCommand, openBrowser } from './session.js';

const mocks = vi.hoisted(() => ({
  ab: vi.fn(),
}));

vi.mock('../utils/exec.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/exec.js')>();
  return {
    ...original,
    ab: mocks.ab,
  };
});

beforeEach(() => {
  mocks.ab.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildOpenBrowserCommand', () => {
  it('builds a default open command without extra flags', () => {
    expect(buildOpenBrowserCommand('http://localhost:3000')).toEqual([
      'open',
      'http://localhost:3000',
    ]);
  });

  it('includes headed mode when headless is disabled', () => {
    expect(buildOpenBrowserCommand('http://localhost:3000', false)).toEqual([
      'open',
      'http://localhost:3000',
      '--headed',
    ]);
  });

  it('includes configurable browser flags from ProofShot config', () => {
    expect(
      buildOpenBrowserCommand('https://localhost:3000', true, {
        ignoreHttpsErrors: true,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      }),
    ).toEqual([
      'open',
      'https://localhost:3000',
      '--ignore-https-errors',
      '--executable-path',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]);
  });

  it('keeps data URLs containing shell metacharacters in one argument', () => {
    expect(
      buildOpenBrowserCommand("data:text/html,<h1 id='ready'>Ready</h1>"),
    ).toEqual([
      'open',
      "data:text/html,<h1 id='ready'>Ready</h1>",
    ]);
  });
});

describe('openBrowser', () => {
  it('continues when a slow page reached the target URL before load timed out', () => {
    mocks.ab
      .mockImplementationOnce(() => {
        throw new ProofShotError('Operation timed out. The page may still be loading.');
      })
      .mockReturnValueOnce('http://localhost:3000/')
      .mockReturnValueOnce('');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    openBrowser(
      'http://localhost:3000',
      { width: 1280, height: 720 },
      true,
      'slow-page',
    );

    expect(mocks.ab).toHaveBeenNthCalledWith(2, ['get', 'url'], {
      session: 'slow-page',
    });
    expect(mocks.ab).toHaveBeenNthCalledWith(3, ['set', 'viewport', '1280', '720'], {
      session: 'slow-page',
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('preserves a navigation timeout when the target URL was not reached', () => {
    const error = new ProofShotError(
      'Operation timed out. The page may still be loading.',
    );
    mocks.ab
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockReturnValueOnce('about:blank');

    expect(() =>
      openBrowser(
        'http://localhost:3000',
        { width: 1280, height: 720 },
        true,
        'failed-page',
      ),
    ).toThrow(error);
  });
});
