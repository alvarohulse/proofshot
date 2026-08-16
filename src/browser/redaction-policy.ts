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

type FusedSecretFieldRule = {
  prefixes: readonly string[];
  suffixes: readonly string[];
};

// Separator-free names cannot be tokenized safely. Match only conventional
// credential compounds, including the singular and plural terminal nouns.
// This keeps unrelated words such as bodyguard and tokenizer public without
// relying on an open-ended credential-prefix or credential-suffix heuristic.
const CONVENTIONAL_FUSED_SECRET_FIELD_GRAMMAR: readonly FusedSecretFieldRule[] = [
  {
    prefixes: ['access', 'auth', 'bearer', 'csrf', 'id', 'refresh', 'session'],
    suffixes: ['token', 'tokens'],
  },
  {
    prefixes: ['auth', 'authorization'],
    suffixes: ['code', 'codes', 'key', 'keys'],
  },
  {
    prefixes: ['session'],
    suffixes: ['id', 'ids'],
  },
  {
    prefixes: ['client'],
    suffixes: ['secret', 'secrets'],
  },
  {
    prefixes: ['password'],
    suffixes: ['hash', 'hashes'],
  },
  {
    prefixes: ['secretaccess'],
    suffixes: ['key', 'keys'],
  },
  {
    prefixes: ['request', 'response'],
    suffixes: ['body', 'bodies', 'header', 'headers'],
  },
  {
    prefixes: ['authorization', 'cookie'],
    suffixes: ['header', 'headers'],
  },
  {
    prefixes: ['token', 'secret'],
    suffixes: ['value', 'values'],
  },
  {
    prefixes: ['aws'],
    suffixes: ['accesskeyid', 'accesskeyids'],
  },
];
const CONVENTIONAL_FUSED_SECRET_FIELDS = new Set(
  CONVENTIONAL_FUSED_SECRET_FIELD_GRAMMAR.flatMap(({ prefixes, suffixes }) =>
    prefixes.flatMap((prefix) =>
      suffixes.map((suffix) => `${prefix}${suffix}`),
    ),
  ),
);
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
    terms.some(hasConventionalFusedSecretShape) ||
    hasConventionalFusedSecretShape(terms.join('')) ||
    terms.includes('apikey') ||
    isApiKey(terms)
  );
}

function hasConventionalFusedSecretShape(term: string): boolean {
  return CONVENTIONAL_FUSED_SECRET_FIELDS.has(term);
}

function isApiKey(terms: string[]): boolean {
  return terms.some(
    (term, index) => term === 'api' && terms[index + 1] === 'key',
  );
}
