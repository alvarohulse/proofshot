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
    expect(
      classifyInteraction(['find', 'nth', '2', 'a', 'click']),
    ).toBe('pointer-keyboard');
    expect(classifyInteraction(['keyboard', 'inserttext', 'private'])).toBe(
      'hybrid',
    );
    expect(classifyInteraction(['keydown', 'Shift'])).toBe('pointer-keyboard');
    expect(classifyInteraction(['storage', 'get', 'theme'])).toBe('observation');
    expect(classifyInteraction(['storage', 'set', 'theme', 'dark'])).toBe('setup');
    expect(classifyInteraction(['network', 'requests'])).toBe('observation');
    expect(classifyInteraction(['network', 'har', 'start'])).toBe('setup');
  });

  it('rejects synthetic DOM mutation hidden in nested batch commands', () => {
    const syntheticCommand = JSON.stringify([
      'eval',
      'document.querySelector("button").click()',
    ]);
    const nestedBatch = JSON.stringify([
      'batch',
      syntheticCommand,
    ]);

    expect(
      classifyInteraction([
        'batch',
        '--bail',
        '["open","https://example.com"]',
        syntheticCommand,
      ]),
    ).toBe('synthetic-dom');
    expect(
      classifyInteraction(['batch', nestedBatch]),
    ).toBe('synthetic-dom');
    expect(
      classifyInteraction([
        'batch',
        'open https://example.com',
        'eval "document.body.click()"',
      ]),
    ).toBe('synthetic-dom');
    expect(classifyInteraction(['batch', '["snapshot","-i"]'])).toBe(
      'observation',
    );
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
    expect(
      buildSanitizedCommandIntent([
        'find',
        'nth',
        '2',
        '.card',
        'fill',
        'private-nth-value',
      ]).summary,
    ).toBe('find nth 2 .card fill [REDACTED]');
    expect(
      buildSanitizedCommandIntent([
        'open',
        'https://api.example.com',
        '--headers',
        '{"Authorization":"Bearer private-header-token"}',
      ]).summary,
    ).toBe('open https://api.example.com/ --headers [REDACTED]');
    expect(
      buildSanitizedCommandIntent([
        'open',
        'https://api.example.com',
        '--headers={"Authorization":"Bearer private-inline-token"}',
      ]).summary,
    ).toBe('open https://api.example.com/ --headers=[REDACTED]');
    expect(
      buildSanitizedCommandIntent([
        'keyboard',
        'inserttext',
        'private-keyboard-value',
      ]).summary,
    ).toBe('keyboard inserttext [REDACTED]');

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
