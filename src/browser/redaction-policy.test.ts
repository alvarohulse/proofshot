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
    'passwords',
    'clientSecret',
    'clientSecrets',
    'session',
    'sessionId',
    'sessions',
    'sig',
    'sigs',
    'X-Amz-Signature',
    'signatures',
    'accessToken',
    'accessTokens',
    'headers',
    'requestBody',
    'responseBodies',
    'api-key',
    'apiKey',
    'apiKeys',
  ])('recognizes normalized high-confidence field %s', (field) => {
    expect(isHighConfidenceSecretField(field)).toBe(true);
  });

  it.each(['code', 'codes', 'key', 'keys', 'status', 'monkey', 'decode'])(
    'does not treat ambiguous or unrelated field %s as high-confidence',
    (field) => {
      expect(isHighConfidenceSecretField(field)).toBe(false);
    },
  );

  it.each(['code', 'codes', 'inviteCode', 'key', 'keys', 'product_key'])(
    'treats ambiguous field %s as sensitive only in URL context',
    (field) => {
      expect(isSensitiveUrlField(field)).toBe(true);
    },
  );

  it('recognizes secret-bearing command flags without inspecting their values', () => {
    expect(isSecretBearingCommandArgument('--cookies')).toBe(true);
    expect(isSecretBearingCommandArgument('--api-key=private')).toBe(true);
    expect(isSecretBearingCommandArgument('--access-token=private')).toBe(true);
    expect(isSecretBearingCommandArgument('--access-tokens=private')).toBe(true);
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
