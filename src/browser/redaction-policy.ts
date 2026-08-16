const HIGH_CONFIDENCE_SECRET_TERMS = new Set([
  'auth',
  'authorization',
  'body',
  'cookie',
  'credential',
  'header',
  'password',
  'secret',
  'session',
  'sig',
  'signature',
  'token',
]);
const URL_ONLY_SECRET_TERMS = new Set(['code', 'key']);
const PLURAL_FIELD_TERMS = new Map([
  ['apikeys', 'apikey'],
  ['auths', 'auth'],
  ['authorizations', 'authorization'],
  ['bodies', 'body'],
  ['codes', 'code'],
  ['cookies', 'cookie'],
  ['credentials', 'credential'],
  ['headers', 'header'],
  ['keys', 'key'],
  ['passwords', 'password'],
  ['secrets', 'secret'],
  ['sessions', 'session'],
  ['sigs', 'sig'],
  ['signatures', 'signature'],
  ['tokens', 'token'],
]);

export function isHighConfidenceSecretField(value: string): boolean {
  const terms = normalizeFieldName(value);
  return containsHighConfidenceSecretTerm(terms);
}

export function isSensitiveUrlField(value: string): boolean {
  const terms = normalizeFieldName(value);
  return (
    containsHighConfidenceSecretTerm(terms) ||
    terms.some((term) => URL_ONLY_SECRET_TERMS.has(term))
  );
}

export function isSecretBearingCommandArgument(value: string): boolean {
  const equalsIndex = value.indexOf('=');
  const field = equalsIndex >= 0 ? value.slice(0, equalsIndex) : value;
  if (!/^(?:--)?[A-Za-z][A-Za-z0-9_-]*$/.test(field)) {
    return false;
  }
  const terms = normalizeFieldName(field);
  if (field.startsWith('--')) {
    return containsHighConfidenceSecretTerm(terms);
  }
  return (
    (terms.length === 1 && containsHighConfidenceSecretTerm(terms)) ||
    (terms.length === 2 && isApiKey(terms))
  );
}

export function isAuthenticationPathSegment(value: string): boolean {
  const terms = normalizeFieldName(value);
  return (
    terms.length === 1 &&
    (terms[0] === 'auth' || terms[0] === 'authorization')
  );
}

function normalizeFieldName(value: string): string[] {
  return value
    .replace(/^-+/, '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0)
    .map((term) => PLURAL_FIELD_TERMS.get(term) || term);
}

function containsHighConfidenceSecretTerm(terms: string[]): boolean {
  return (
    terms.some((term) => HIGH_CONFIDENCE_SECRET_TERMS.has(term)) ||
    terms.includes('apikey') ||
    isApiKey(terms)
  );
}

function isApiKey(terms: string[]): boolean {
  return terms.some(
    (term, index) => term === 'api' && terms[index + 1] === 'key',
  );
}
