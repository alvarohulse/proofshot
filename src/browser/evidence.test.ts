import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSanitizedNetworkSummary,
  finalizePrivateNetworkCapture,
  formatAgentBrowserOutputForDisplay,
  sanitizeAgentBrowserError,
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

  it('redacts signed URL keys and sensitive endpoint path values', () => {
    const summary = buildSanitizedNetworkSummary({
      log: {
        entries: [
          {
            time: 1,
            request: {
              method: 'GET',
              url: 'https://example.test/download/token/private-path?signature=private-signature',
            },
            response: { status: 200 },
          },
        ],
      },
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('private-path');
    expect(serialized).not.toContain('private-signature');
    expect(summary.requests[0]?.endpoint).toBe(
      'https://example.test/download/token/%5BREDACTED%5D',
    );
  });

  it('keeps raw structured results only in private action evidence', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-private-result-'),
    );
    try {
      const receipt = writePrivateAgentBrowserResult({
        args: ['cookies', 'get'],
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
      expect(evidence).toContain('private-cookie');
      expect(receipt.evidencePath).toMatch(/^private\/agent-browser\/actions\//);
      expect(fs.statSync(evidencePath).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('keeps safe observations useful while redacting secret-bearing results', () => {
    expect(
      formatAgentBrowserOutputForDisplay({
        args: ['snapshot', '-i'],
        rawOutput: JSON.stringify({
          success: true,
          data: { snapshot: 'button "Submit" [ref=e1]' },
        }),
        success: true,
      }),
    ).toBe('button "Submit" [ref=e1]');
    expect(
      formatAgentBrowserOutputForDisplay({
        args: ['fill', '@e1', 'private-value'],
        rawOutput: JSON.stringify({
          success: true,
          data: { value: 'private-value' },
        }),
        success: true,
      }),
    ).toBe('[REDACTED]');
    expect(
      sanitizeAgentBrowserError(
        ['type', '@e1', 'private-value'],
        'failed to type private-value',
      ),
    ).not.toContain('private-value');
  });

  it('applies the shared secret policy to structured browser results', () => {
    const display = formatAgentBrowserOutputForDisplay({
      args: ['snapshot', '-i'],
      rawOutput: JSON.stringify({
        success: true,
        data: {
          auth: 'private-auth',
          cookies: [{ name: 'theme', value: 'private-cookie' }],
          session: 'private-session',
          signature: 'private-signature',
          code: 'visible-code',
          key: 'visible-key',
          status: 'visible',
        },
      }),
      success: true,
    });
    const result = JSON.parse(display) as {
      data: Record<string, unknown>;
    };

    expect(result.data).toMatchObject({
      auth: '[REDACTED]',
      cookies: '[REDACTED]',
      session: '[REDACTED]',
      signature: '[REDACTED]',
      code: 'visible-code',
      key: 'visible-key',
      status: 'visible',
    });
  });

  it.each([
    ['tokens', 'private-tokens'],
    ['accessTokens', 'private-access-tokens'],
    ['sessions', 'private-sessions'],
    ['signatures', 'private-signatures'],
    ['passwords', 'private-passwords'],
    ['secrets', 'private-secrets'],
  ])('redacts plural structured field %s', (field, secret) => {
    const display = formatAgentBrowserOutputForDisplay({
      args: ['snapshot', '-i'],
      rawOutput: JSON.stringify({
        success: true,
        data: {
          [field]: secret,
          code: 'visible-code',
          codes: 'visible-codes',
          key: 'visible-key',
          keys: 'visible-keys',
        },
      }),
      success: true,
    });
    const result = JSON.parse(display) as {
      data: Record<string, unknown>;
    };

    expect(result.data[field]).toBe('[REDACTED]');
    expect(result.data.code).toBe('visible-code');
    expect(result.data.codes).toBe('visible-codes');
    expect(result.data.key).toBe('visible-key');
    expect(result.data.keys).toBe('visible-keys');
  });

  it.each([
    ['sessionid', 'private-session-id'],
    ['authcode', 'private-auth-code'],
    ['authtoken', 'private-auth-token'],
    ['csrftoken', 'private-csrf-token'],
    ['awsaccesskeyid', 'private-access-key-id'],
    ['AwsAccessKeyId', 'private-mixed-case-access-key-id'],
    ['accesstoken', 'private-access-token'],
    ['refreshtoken', 'private-refresh-token'],
    ['idtoken', 'private-id-token'],
    ['clientsecret', 'private-client-secret'],
    ['passwordhash', 'private-password-hash'],
    ['authorizationcode', 'private-authorization-code'],
    ['sessiontoken', 'private-session-token'],
    ['bearertoken', 'private-bearer-token'],
    ['secretaccesskey', 'private-secret-access-key'],
  ])('redacts fused structured field %s', (field, secret) => {
    const display = formatAgentBrowserOutputForDisplay({
      args: ['snapshot', '-i'],
      rawOutput: JSON.stringify({
        success: true,
        data: {
          [field]: secret,
          monkey: 'visible',
          decode: 'visible',
          bodyguard: 'visible',
          tokenizer: 'visible',
        },
      }),
      success: true,
    });
    const result = JSON.parse(display) as {
      data: Record<string, unknown>;
    };

    expect(result.data[field]).toBe('[REDACTED]');
    expect(result.data.monkey).toBe('visible');
    expect(result.data.decode).toBe('visible');
    expect(result.data.bodyguard).toBe('visible');
    expect(result.data.tokenizer).toBe('visible');
  });

  it.each([
    'value',
    'data-access-token',
    'sessionid',
    'accesstoken',
    'refreshtoken',
    'idtoken',
    'clientsecret',
    'passwordhash',
    'authorizationcode',
    'sessiontoken',
    'bearertoken',
    'secretaccesskey',
  ])(
    'redacts get attr output for secret attribute %s',
    (attribute) => {
      expect(
        formatAgentBrowserOutputForDisplay({
          args: ['get', 'attr', '@e1', attribute],
          rawOutput: JSON.stringify({
            success: true,
            data: { value: 'private-value', origin: 'attribute' },
          }),
          success: true,
        }),
      ).toBe('[REDACTED]');
    },
  );

  it.each([
    ['aria-label', 'Submit'],
    ['data-testid', 'submit-button'],
    ['monkey', 'visible-monkey'],
    ['decode', 'visible-decode'],
    ['bodyguard', 'visible-bodyguard'],
    ['tokenizer', 'visible-tokenizer'],
  ])('keeps safe get attr output useful for %s', (attribute, value) => {
    expect(
      formatAgentBrowserOutputForDisplay({
        args: ['get', 'attr', '@e1', attribute],
        rawOutput: JSON.stringify({
          success: true,
          data: { value, origin: 'attribute' },
        }),
        success: true,
      }),
    ).toBe(value);
  });

  it.each([
    '--auth=private-auth',
    '--cookies=private-cookie',
    '--session=private-session',
    '--signature=private-signature',
  ])('redacts output from shared secret-bearing flag %s', (flag) => {
    expect(
      formatAgentBrowserOutputForDisplay({
        args: ['snapshot', flag],
        rawOutput: JSON.stringify({
          success: true,
          data: { status: 'private-output' },
        }),
        success: true,
      }),
    ).toBe('[REDACTED]');
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
    mocks.ab.mockImplementation((command: string[]) => {
      if (command.slice(0, 3).join(' ') === 'network har stop') {
        fs.writeFileSync(
          `${paths.harPath}.pending`,
          JSON.stringify({ log: { entries: [] } }),
        );
        return JSON.stringify({ success: true });
      }
      if (command.join(' ') === 'network requests --json') {
        throw new Error('request inventory failed');
      }
      throw new Error(`unexpected command: ${command.join(' ')}`);
    });

    try {
      const summary = finalizePrivateNetworkCapture('ps-test', paths);

      expect(summary.requestCount).toBe(0);
      expect(mocks.ab).toHaveBeenCalledTimes(2);
      expect(mocks.ab.mock.calls[0][0]).toContain(`${paths.harPath}.pending`);
      expect(mocks.ab.mock.calls[1][0]).toEqual(['network', 'requests', '--json']);
      expect(fs.existsSync(`${paths.harPath}.pending`)).toBe(false);
      expect(fs.existsSync(paths.harPath)).toBe(true);
      expect(fs.readFileSync(paths.requestsPath, 'utf-8')).toContain(
        'request inventory failed',
      );
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('adopts a valid pending HAR when the stop command reports failure', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-network-stop-error-'),
    );
    const privateDirectory = path.join(sessionDir, 'private', 'agent-browser');
    const paths = {
      privateDirectory,
      harPath: path.join(privateDirectory, 'network.har'),
      requestsPath: path.join(privateDirectory, 'requests.json'),
      summaryPath: path.join(sessionDir, 'network-summary.json'),
    };
    mocks.ab.mockImplementation((command: string[]) => {
      if (command.slice(0, 3).join(' ') === 'network har stop') {
        fs.writeFileSync(
          `${paths.harPath}.pending`,
          JSON.stringify({ log: { entries: [] } }),
        );
        throw new Error('HAR stop response was lost');
      }
      if (command.join(' ') === 'network requests --json') {
        return JSON.stringify({ success: true, data: [] });
      }
      throw new Error(`unexpected command: ${command.join(' ')}`);
    });

    try {
      expect(finalizePrivateNetworkCapture('ps-test', paths)).toMatchObject({
        requestCount: 0,
      });
      expect(fs.existsSync(paths.harPath)).toBe(true);
      expect(fs.existsSync(`${paths.harPath}.pending`)).toBe(false);
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('adopts a complete pending HAR after interrupted finalization', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-network-recovery-'),
    );
    const privateDirectory = path.join(sessionDir, 'private', 'agent-browser');
    fs.mkdirSync(privateDirectory, { recursive: true });
    const paths = {
      privateDirectory,
      harPath: path.join(privateDirectory, 'network.har'),
      requestsPath: path.join(privateDirectory, 'requests.json'),
      summaryPath: path.join(sessionDir, 'network-summary.json'),
    };
    fs.writeFileSync(
      `${paths.harPath}.pending`,
      JSON.stringify({
        log: {
          entries: [
            {
              time: 4,
              request: { method: 'GET', url: 'https://example.com/recovered' },
              response: { status: 200 },
            },
          ],
        },
      }),
    );
    mocks.ab.mockImplementation((command: string[]) => {
      if (command.join(' ') === 'network requests --json') {
        return JSON.stringify({ success: true, data: [] });
      }
      throw new Error(`unexpected command: ${command.join(' ')}`);
    });

    try {
      const summary = finalizePrivateNetworkCapture('ps-test', paths);

      expect(summary.requests).toEqual([
        {
          endpoint: 'https://example.com/recovered',
          method: 'GET',
          status: 200,
          durationMs: 4,
          error: null,
        },
      ]);
      expect(mocks.ab).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(`${paths.harPath}.pending`)).toBe(false);
      expect(fs.statSync(paths.harPath).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('adopts existing HAR evidence without browser commands after browser loss', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-network-offline-recovery-'),
    );
    const privateDirectory = path.join(sessionDir, 'private', 'agent-browser');
    fs.mkdirSync(privateDirectory, { recursive: true });
    const paths = {
      privateDirectory,
      harPath: path.join(privateDirectory, 'network.har'),
      requestsPath: path.join(privateDirectory, 'requests.json'),
      summaryPath: path.join(sessionDir, 'network-summary.json'),
    };
    fs.writeFileSync(
      paths.harPath,
      JSON.stringify({
        log: {
          entries: [
            {
              time: 9,
              request: { method: 'GET', url: 'https://example.com/offline' },
              response: { status: 204 },
            },
          ],
        },
      }),
    );
    fs.writeFileSync(paths.requestsPath, 'retained request evidence\n');

    try {
      const summary = finalizePrivateNetworkCapture('ps-test', paths, {
        allowBrowserCommands: false,
      });

      expect(summary.requests).toEqual([
        {
          endpoint: 'https://example.com/offline',
          method: 'GET',
          status: 204,
          durationMs: 9,
          error: null,
        },
      ]);
      expect(mocks.ab).not.toHaveBeenCalled();
      expect(fs.readFileSync(paths.requestsPath, 'utf-8')).toBe(
        'retained request evidence\n',
      );
      expect(fs.statSync(paths.harPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(paths.summaryPath).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('refuses an invalid HAR without adopting a partial final file', () => {
    const sessionDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'proofshot-network-invalid-'),
    );
    const privateDirectory = path.join(sessionDir, 'private', 'agent-browser');
    fs.mkdirSync(privateDirectory, { recursive: true });
    const paths = {
      privateDirectory,
      harPath: path.join(privateDirectory, 'network.har'),
      requestsPath: path.join(privateDirectory, 'requests.json'),
      summaryPath: path.join(sessionDir, 'network-summary.json'),
    };
    mocks.ab.mockImplementation((command: string[]) => {
      if (command.slice(0, 3).join(' ') === 'network har stop') {
        fs.writeFileSync(`${paths.harPath}.pending`, '{');
        return JSON.stringify({ success: true });
      }
      throw new Error(`unexpected command: ${command.join(' ')}`);
    });

    try {
      expect(() => finalizePrivateNetworkCapture('ps-test', paths)).toThrow(
        'agent-browser did not write valid HAR evidence',
      );
      expect(fs.existsSync(paths.harPath)).toBe(false);
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  });
});
