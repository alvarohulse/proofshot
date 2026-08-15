import { describe, expect, it } from 'vitest';
import {
  buildSanitizedCommandIntent,
  classifyInteraction,
  sanitizeDiagnosticMessage,
  sanitizePageUrl,
} from './provenance.js';

describe('browser interaction provenance', () => {
  it('classifies user-equivalent, hybrid, diagnostic, and observation commands honestly', () => {
    expect(classifyInteraction(['click', '@e1'])).toBe('pointer-keyboard');
    expect(classifyInteraction(['fill', '@e2', 'value'])).toBe('hybrid');
    expect(classifyInteraction(['eval', 'document.body.click()'])).toBe(
      'synthetic-dom',
    );
    expect(classifyInteraction(['snapshot', '-i'])).toBe('observation');
    expect(classifyInteraction(['open', 'https://example.com'])).toBe('setup');
  });

  it('redacts typed values, credentials, scripts, and sensitive URL parameters', () => {
    expect(
      buildSanitizedCommandIntent(['fill', '@e2', 'private-value']).summary,
    ).toBe('fill @e2 [REDACTED]');
    expect(
      buildSanitizedCommandIntent([
        'set',
        'credentials',
        'private-user',
        'private-password',
      ]).summary,
    ).toBe('set credentials [REDACTED]');
    expect(
      buildSanitizedCommandIntent([
        'eval',
        "document.querySelector('#secret').value",
      ]).summary,
    ).toBe('eval [REDACTED_SCRIPT]');

    const url = sanitizePageUrl(
      'https://user:pass@example.com/callback?token=private&tab=profile',
    );
    expect(url).toBe(
      'https://example.com/callback?token=%5BREDACTED%5D&tab=profile',
    );
  });

  it('redacts secret-shaped diagnostics before persistence', () => {
    const message = sanitizeDiagnosticMessage(
      'authorization: Bearer private-token token=another-private-value',
    );
    expect(message).not.toContain('private-token');
    expect(message).not.toContain('another-private-value');
    expect(message).toContain('[REDACTED]');
  });
});
