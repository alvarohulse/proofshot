import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSanitizedNetworkSummary,
  finalizePrivateNetworkCapture,
  writePrivateAgentBrowserResult,
} from './evidence.js';

const mocks = vi.hoisted(() => ({ ab: vi.fn() }));

vi.mock('../utils/exec.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/exec.js')>()),
  ab: mocks.ab,
}));

afterEach(() => {
  mocks.ab.mockReset();
});

describe('private browser evidence', () => {
  it('produces a deterministic metadata-only network summary', () => {
    const entries = [
      {
        time: 20.12345,
        request: {
          method: 'POST',
          url: 'https://example.com/z?token=private-token',
          headers: [{ name: 'authorization', value: 'private-auth' }],
        },
        response: {
          status: 500,
          content: { text: 'private-response-body' },
          _error: 'request failed with token=private-error',
        },
      },
      {
        time: 5,
        request: {
          method: 'GET',
          url: 'https://example.com/a?customer=private-customer',
        },
        response: { status: 200 },
      },
    ];

    const summary = buildSanitizedNetworkSummary({ log: { entries } });
    const reversed = buildSanitizedNetworkSummary({
      log: { entries: [...entries].reverse() },
    });

    expect(summary).toEqual(reversed);
    expect(summary.requests).toEqual([
      {
        endpoint: 'https://example.com/a',
        method: 'GET',
        status: 200,
        durationMs: 5,
        error: null,
      },
      {
        endpoint: 'https://example.com/z',
        method: 'POST',
        status: 500,
        durationMs: 20.123,
        error: 'request failed with token=[REDACTED]',
      },
    ]);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('private-auth');
    expect(serialized).not.toContain('private-response-body');
    expect(serialized).not.toContain('private-customer');
    expect(serialized).not.toContain('private-error');
  });

  it('redacts sensitive structured results before writing local action evidence', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-private-result-'),
    );
    try {
      const receipt = writePrivateAgentBrowserResult({
        command: 'cookies',
        sessionDir,
        rawOutput: JSON.stringify({
          success: true,
          data: {
            cookies: [{ name: 'session', value: 'private-cookie' }],
          },
        }),
        success: true,
      });
      const evidencePath = path.join(sessionDir, receipt.evidencePath);
      const evidence = fs.readFileSync(evidencePath, 'utf-8');
      expect(evidence).not.toContain('private-cookie');
      expect(evidence).toContain('[REDACTED]');
      expect(fs.statSync(evidencePath).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('still stops HAR capture when the request inventory command fails', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-network-finalize-'),
    );
    const privateDirectory = path.join(sessionDir, 'private', 'agent-browser');
    const paths = {
      privateDirectory,
      harPath: path.join(privateDirectory, 'network.har'),
      requestsPath: path.join(privateDirectory, 'requests.json'),
      summaryPath: path.join(sessionDir, 'network-summary.json'),
    };
    mocks.ab.mockImplementation((command: string) => {
      if (command === 'network requests --json') {
        throw new Error('request inventory failed');
      }
      if (command.startsWith('network har stop ')) {
        fs.writeFileSync(paths.harPath, JSON.stringify({ log: { entries: [] } }));
        return JSON.stringify({ success: true });
      }
      throw new Error(`unexpected command: ${command}`);
    });

    try {
      const summary = finalizePrivateNetworkCapture('ps-test', paths);

      expect(summary.requestCount).toBe(0);
      expect(mocks.ab).toHaveBeenCalledTimes(2);
      expect(mocks.ab.mock.calls[1][0]).toContain('network har stop');
      expect(fs.readFileSync(paths.requestsPath, 'utf-8')).toContain(
        'request inventory failed',
      );
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  });
});
