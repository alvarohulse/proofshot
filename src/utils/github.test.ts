import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatPRComment } from '../artifacts/pr-format.js';
import {
  getGitHubToken,
  getRepoInfo,
  uploadAsset,
} from './github.js';

describe('getGitHubToken', () => {
  afterEach(() => {
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  it('prefers GH_TOKEN from the environment', () => {
    process.env.GH_TOKEN = ' env-token ';

    expect(getGitHubToken()).toBe('env-token');
  });
});

describe('uploadAsset', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('surfaces a targeted message for auth-related web attachment failures', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofshot-github-test-'));
    const filePath = path.join(tmpDir, 'step.png');
    fs.writeFileSync(filePath, 'test');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('unprocessable entity', {
          status: 422,
        }),
      ),
    );

    await expect(uploadAsset(filePath, 'token', 1)).rejects.toThrow(
      /github-web-attachments|repo-contents|GH_TOKEN/,
    );
  });
});

describe('getRepoInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('resolves the validated target repository instead of the checkout parent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 123,
          default_branch: 'main',
          private: false,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getRepoInfo('token', 'github.com/alvarohulse/proofshot'),
    ).resolves.toEqual({
      owner: 'alvarohulse',
      repo: 'proofshot',
      id: 123,
      defaultBranch: 'main',
      isPrivate: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/alvarohulse/proofshot',
      expect.any(Object),
    );
  });
});

describe('formatPRComment', () => {
  it('renders repo-contents videos as links', () => {
    const body = formatPRComment({
      description: 'Verify checkout',
      sessionCount: 1,
      screenshots: new Map([['step.png', 'https://example.com/step.png']]),
      video: {
        url: 'https://example.com/session.mp4',
        renderMode: 'link',
      },
      errorCount: 0,
      verdict: 'FAIL',
      verdictReasons: ['Expected checkout button was missing.'],
      userTesting: [
        {
          label: 'checkout',
          instructions: ['Open checkout.', 'Submit the order.'],
        },
      ],
      branch: 'feature/test',
      commitSha: 'abcdef123456',
    });

    expect(body).toContain('[Session recording](https://example.com/session.mp4)');
    expect(body).toContain('❌ Verification failed');
    expect(body).toContain('Expected checkout button was missing.');
    expect(body).toContain('### User testing\n\n1. Open checkout.');
    expect(body).not.toContain('\nhttps://example.com/session.mp4\n');
  });

  it('renders recordings for every selected session', () => {
    const body = formatPRComment({
      description: null,
      sessionCount: 2,
      screenshots: new Map(),
      video: null,
      recordings: [
        {
          label: 'checkout',
          url: 'https://example.com/checkout.mp4',
          renderMode: 'link',
        },
        {
          label: 'settings',
          url: 'https://example.com/settings.mp4',
          renderMode: 'link',
        },
      ],
      errorCount: 0,
      verdict: 'PASS',
      verdictReasons: [],
      branch: 'feature/test',
      commitSha: 'abcdef123456',
    });

    expect(body).toContain('### Recordings');
    expect(body).toContain(
      '[Session recording: checkout](https://example.com/checkout.mp4)',
    );
    expect(body).toContain(
      '[Session recording: settings](https://example.com/settings.mp4)',
    );
  });
});
