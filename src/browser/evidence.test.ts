import { describe, expect, it } from 'vitest';
import { buildSanitizedNetworkSummary } from './evidence.js';

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
});
