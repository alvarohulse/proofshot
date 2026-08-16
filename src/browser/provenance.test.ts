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
    expect(classifyInteraction(['find', 'text', 'Submit'])).toBe(
      'pointer-keyboard',
    );
    expect(classifyInteraction(['find', 'nth', '2', '.card'])).toBe(
      'pointer-keyboard',
    );
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
      [
        'Authorization: Bearer private-bearer-token',
        'authorization=Basic cHJpdmF0ZTpzZWNyZXQ=',
        'token=another-private-value',
        'https://downloads.example.test/accounts/token/private-path/report?X-Amz-Signature=private-signature&safe=yes',
      ].join('\n'),
    );
    expect(message).not.toContain('private-bearer-token');
    expect(message).not.toContain('cHJpdmF0ZTpzZWNyZXQ=');
    expect(message).not.toContain('another-private-value');
    expect(message).not.toContain('private-signature');
    expect(message).not.toContain('private-path');
    expect(message).toContain('safe=yes');
    expect(message).toContain('[REDACTED]');
  });

  it('redacts compound secret keys and complete quoted values', () => {
    const message = sanitizeDiagnosticMessage(
      [
        'client_secret=private-client-secret',
        'access_token: private-access-token',
        'password="correct horse battery staple"',
        "refresh_token='private refresh token'",
      ].join('\n'),
    );

    expect(message).not.toContain('private-client-secret');
    expect(message).not.toContain('private-access-token');
    expect(message).not.toContain('correct horse battery staple');
    expect(message).not.toContain('private refresh token');
    expect(message).not.toContain('horse battery staple');
  });

  it('redacts structured and escaped diagnostic secret values', () => {
    const message = sanitizeDiagnosticMessage(
      [
        '{"clientSecret":"private-client","safe":"visible"}',
        '{"auth":{"accessToken":"private-access"},"status":"healthy"}',
        '{"token":["private-first","private-second"],"safeList":["one","two"]}',
        String.raw`password="private-prefix \"quoted\" private-suffix"`,
      ].join('\n'),
    );

    expect(message).not.toContain('private-client');
    expect(message).not.toContain('private-access');
    expect(message).not.toContain('private-first');
    expect(message).not.toContain('private-second');
    expect(message).not.toContain('private-prefix');
    expect(message).not.toContain('private-suffix');
    expect(message).toContain('"safe":"visible"');
    expect(message).toContain('"status":"healthy"');
    expect(message).toContain('"safeList":["one","two"]');
  });

  it('redacts signed URL keys and sensitive path values', () => {
    expect(
      sanitizePageUrl(
        'https://example.test/api/credentials/private-credential/file?sig=private-sig&signature=private-signature&view=full',
      ),
    ).toBe(
      'https://example.test/api/credentials/%5BREDACTED%5D/file?sig=%5BREDACTED%5D&signature=%5BREDACTED%5D&view=full',
    );
  });

  it('redacts bearer tokens from authentication route paths', () => {
    expect(
      sanitizePageUrl(
        'https://example.test/reset-password/private-reset-token',
      ),
    ).toBe('https://example.test/reset-password/%5BREDACTED%5D');
    expect(
      sanitizePageUrl('https://example.test/invite/private-invite-token'),
    ).toBe('https://example.test/invite/%5BREDACTED%5D');
    expect(
      sanitizePageUrl('https://example.test/magic-link/private-magic-token'),
    ).toBe('https://example.test/magic-link/%5BREDACTED%5D');
    expect(
      sanitizePageUrl(
        'https://example.test/invite/accept/private-invite-token',
      ),
    ).toBe(
      'https://example.test/invite/%5BREDACTED%5D/%5BREDACTED%5D',
    );
    expect(
      sanitizePageUrl(
        'https://example.test/reset-password/confirm/private-reset-token',
      ),
    ).toBe(
      'https://example.test/reset-password/%5BREDACTED%5D/%5BREDACTED%5D',
    );
    expect(
      sanitizePageUrl(
        'https://example.test/auth/invite/accept/private-token',
      ),
    ).toBe(
      'https://example.test/auth/invite/%5BREDACTED%5D/%5BREDACTED%5D',
    );
    expect(
      sanitizePageUrl(
        'https://example.test/api/auth/reset-password/confirm/private-token',
      ),
    ).toBe(
      'https://example.test/api/auth/reset-password/%5BREDACTED%5D/%5BREDACTED%5D',
    );
  });
});
