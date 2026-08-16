import { describe, expect, it } from 'vitest';
import {
  isAuthenticationPathSegment,
  isHighConfidenceSecretField,
  isSecretBearingCommandArgument,
  isSensitiveUrlField,
} from './redaction-policy.js';

describe('browser redaction policy', () => {
  it.each([
    'auth',
    'authorization',
    'HTTP_AUTHORIZATION',
    'cookie',
    'cookies',
    'credential',
    'credentials',
    'password',
    'clientSecret',
    'session',
    'sessionId',
    'sig',
    'X-Amz-Signature',
    'accessToken',
    'headers',
    'requestBody',
    'api-key',
    'apiKey',
  ])('recognizes normalized high-confidence field %s', (field) => {
    expect(isHighConfidenceSecretField(field)).toBe(true);
  });

  it.each(['code', 'key', 'status', 'monkey', 'decode'])(
    'does not treat ambiguous or unrelated field %s as high-confidence',
    (field) => {
      expect(isHighConfidenceSecretField(field)).toBe(false);
    },
  );

  it.each(['code', 'inviteCode', 'key', 'product_key'])(
    'treats ambiguous field %s as sensitive only in URL context',
    (field) => {
      expect(isSensitiveUrlField(field)).toBe(true);
    },
  );

  it('recognizes secret-bearing command flags without inspecting their values', () => {
    expect(isSecretBearingCommandArgument('--cookies')).toBe(true);
    expect(isSecretBearingCommandArgument('--api-key=private')).toBe(true);
    expect(isSecretBearingCommandArgument('--access-token=private')).toBe(true);
    expect(isSecretBearingCommandArgument('--code=visible')).toBe(false);
    expect(isSecretBearingCommandArgument('--key')).toBe(false);
    expect(
      isSecretBearingCommandArgument(
        'https://example.test/session/private-session',
      ),
    ).toBe(false);
    expect(isSecretBearingCommandArgument('private-session')).toBe(false);
  });

  it('limits fail-closed route handling to auth path segments', () => {
    expect(isAuthenticationPathSegment('auth')).toBe(true);
    expect(isAuthenticationPathSegment('AUTHORIZATION')).toBe(true);
    expect(isAuthenticationPathSegment('oauth')).toBe(false);
    expect(isAuthenticationPathSegment('auth-token')).toBe(false);
  });
});
