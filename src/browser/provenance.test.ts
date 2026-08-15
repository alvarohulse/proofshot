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

  it('classifies nested and keyboard commands by their effective action', () => {
    expect(
      classifyInteraction(['find', 'role', 'button', 'click', '--name', 'Submit']),
    ).toBe('pointer-keyboard');
    expect(
      classifyInteraction(['find', 'label', 'Password', 'fill', 'private']),
    ).toBe('hybrid');
    expect(classifyInteraction(['find', 'text', 'Welcome', 'text'])).toBe(
      'observation',
    );
    expect(classifyInteraction(['keyboard', 'type', 'private'])).toBe(
      'pointer-keyboard',
    );
    expect(classifyInteraction(['keydown', 'Shift'])).toBe('pointer-keyboard');
    expect(classifyInteraction(['storage', 'get', 'theme'])).toBe('observation');
    expect(classifyInteraction(['storage', 'set', 'theme', 'dark'])).toBe('setup');
    expect(classifyInteraction(['network', 'requests'])).toBe('observation');
    expect(classifyInteraction(['network', 'har', 'start'])).toBe('setup');
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

    const nestedSecrets = [
      buildSanitizedCommandIntent([
        'find',
        'label',
        'Password',
        'fill',
        'private-find-value',
      ]).summary,
      buildSanitizedCommandIntent([
        'keyboard',
        'type',
        'private-keyboard-value',
      ]).summary,
      buildSanitizedCommandIntent([
        'storage',
        'local',
        'set',
        'password',
        'private-storage-value',
      ]).summary,
      buildSanitizedCommandIntent([
        'batch',
        '[{"command":"fill","value":"private-batch-value"}]',
      ]).summary,
      buildSanitizedCommandIntent([
        'future-command',
        'private-unknown-value',
      ]).summary,
    ].join('\n');
    expect(nestedSecrets).not.toContain('private-find-value');
    expect(nestedSecrets).not.toContain('private-keyboard-value');
    expect(nestedSecrets).not.toContain('private-storage-value');
    expect(nestedSecrets).not.toContain('private-batch-value');
    expect(nestedSecrets).not.toContain('private-unknown-value');

    const url = sanitizePageUrl(
      'https://user:pass@example.com/callback?token=private&tab=profile',
    );
    expect(url).toBe(
      'https://example.com/callback?token=%5BREDACTED%5D&tab=profile',
    );
  });

  it('sanitizes fragments, opaque URLs, and malformed URLs without recursion', () => {
    expect(
      sanitizePageUrl(
        'https://example.com/callback#access_token=private-fragment-token',
      ),
    ).toBe('https://example.com/callback');
    expect(sanitizePageUrl('data:text/html,private-content')).toBe(
      '[REDACTED_URL:data]',
    );
    expect(sanitizePageUrl('http://[')).toBe('[REDACTED_URL:http]');
    expect(sanitizeDiagnosticMessage('request failed at http://[')).toBe(
      'request failed at [REDACTED_URL:http]',
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
