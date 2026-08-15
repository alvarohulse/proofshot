const REDACTED = '[REDACTED]';
const REDACTED_ARGUMENTS = '[REDACTED_ARGUMENTS]';
const REDACTED_BATCH = '[REDACTED_BATCH]';
const SECRET_FLAG = /^(?:--)?(?:authorization|cookie|credential|password|secret|token|api[-_]?key|body)$/i;
const SECRET_QUERY_PARAMETER = /(?:auth|code|cookie|credential|key|password|secret|session|token)/i;
const URL_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

const HYBRID_ACTIONS = new Set(['check', 'fill', 'select', 'type', 'uncheck']);
const OBSERVATION_ACTIONS = new Set([
  'assert-visible',
  'console',
  'errors',
  'get',
  'is',
  'read',
  'screenshot',
  'snapshot',
  'text',
]);
const POINTER_KEYBOARD_ACTIONS = new Set([
  'click',
  'dblclick',
  'drag',
  'hover',
  'key',
  'keydown',
  'keyup',
  'mouse',
  'press',
]);
const SETUP_ACTIONS = new Set([
  'auth',
  'close',
  'navigate',
  'open',
  'record',
  'set',
  'tab',
  'upload',
  'wait',
]);

export type InteractionCategory =
  | 'observation'
  | 'pointer-keyboard'
  | 'hybrid'
  | 'setup'
  | 'synthetic-dom'
  | 'unknown';

export type SanitizedCommandIntent = {
  command: string;
  summary: string;
};

export function buildSanitizedCommandIntent(
  args: string[],
): SanitizedCommandIntent {
  const command = args[0]?.toLowerCase() || 'unknown';
  const sanitizedArgs = sanitizeArguments(command, args);
  return {
    command,
    summary: sanitizedArgs.join(' '),
  };
}

export function classifyInteraction(args: string[]): InteractionCategory {
  const command = args[0]?.toLowerCase();
  if (!command) {
    return 'unknown';
  }
  if (command === 'find') {
    const nestedAction = args[3]?.toLowerCase();
    return nestedAction
      ? classifyInteraction([nestedAction])
      : 'observation';
  }
  if (command === 'keyboard') {
    return ['inserttext', 'press', 'type'].includes(args[1]?.toLowerCase())
      ? 'pointer-keyboard'
      : 'unknown';
  }
  if (command === 'cookies' || command === 'storage') {
    return !args[1] || ['get', 'list'].includes(args[1].toLowerCase())
      ? 'observation'
      : 'setup';
  }
  if (command === 'network') {
    return !args[1] || ['get', 'requests'].includes(args[1].toLowerCase())
      ? 'observation'
      : 'setup';
  }
  if (command === 'console') {
    return args[1]?.toLowerCase() === 'clear' ? 'setup' : 'observation';
  }
  if (OBSERVATION_ACTIONS.has(command)) {
    return 'observation';
  }
  if (POINTER_KEYBOARD_ACTIONS.has(command)) {
    return 'pointer-keyboard';
  }
  if (HYBRID_ACTIONS.has(command)) {
    return 'hybrid';
  }
  if (command === 'eval') {
    return 'synthetic-dom';
  }
  if (SETUP_ACTIONS.has(command)) {
    return 'setup';
  }
  return 'unknown';
}

export function sanitizePageUrl(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  return sanitizeUrlValue(value);
}

function sanitizeUrlValue(value: string): string {
  const scheme = value.match(URL_SCHEME)?.[1]?.toLowerCase();
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return url.protocol === 'about:' && url.pathname === 'blank'
        ? 'about:blank'
        : `[REDACTED_URL:${url.protocol.slice(0, -1)}]`;
    }
    url.username = '';
    url.password = '';
    for (const key of url.searchParams.keys()) {
      if (SECRET_QUERY_PARAMETER.test(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }
    url.hash = '';
    return url.toString();
  } catch {
    return scheme ? `[REDACTED_URL:${scheme}]` : '[REDACTED_URL]';
  }
}

export function sanitizeDiagnosticMessage(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  return value
    .replace(/\bBearer\s+[^\s"']+/gi, `Bearer ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(
      /\b(authorization|cookie|credential|password|secret|token|api[-_]?key)\b\s*[:=]\s*([^\s,;]+)/gi,
      `$1=${REDACTED}`,
    )
    .replace(/https?:\/\/[^\s"'<>]+/g, sanitizeUrlValue);
}

function sanitizeArguments(command: string, args: string[]): string[] {
  if (command === 'eval') {
    return [command, '[REDACTED_SCRIPT]'];
  }
  if (command === 'batch') {
    return [command, REDACTED_BATCH];
  }
  if (command === 'auth') {
    return [command, REDACTED_ARGUMENTS];
  }
  if (command === 'find') {
    return sanitizeFindArguments(args);
  }
  if (
    command === 'keyboard' &&
    ['inserttext', 'type'].includes(args[1]?.toLowerCase())
  ) {
    return [command, args[1].toLowerCase(), REDACTED];
  }
  if (['fill', 'select', 'type'].includes(command)) {
    return [command, sanitizeArgument(args[1] || ''), REDACTED];
  }
  if (command === 'set' && ['credentials', 'headers'].includes(args[1]?.toLowerCase())) {
    return [command, args[1].toLowerCase(), REDACTED];
  }
  if (command === 'cookies' && args[1]?.toLowerCase() === 'set') {
    return [command, 'set', sanitizeArgument(args[2] || ''), REDACTED];
  }
  if (command === 'storage') {
    const setIndex = args.findIndex(
      (argument, index) => index > 0 && argument.toLowerCase() === 'set',
    );
    if (setIndex >= 0) {
      return [
        ...args.slice(0, setIndex + 2).map(sanitizeArgument),
        REDACTED,
      ];
    }
  }
  if (command === 'upload') {
    return [command, sanitizeArgument(args[1] || ''), '[LOCAL_FILE]'];
  }
  if (!isKnownCommand(command)) {
    return args.length > 1 ? [command, REDACTED_ARGUMENTS] : [command];
  }

  const sanitized: string[] = [];
  let redactNext = false;
  for (const [index, argument] of args.entries()) {
    if (redactNext) {
      sanitized.push(REDACTED);
      redactNext = false;
      continue;
    }
    if (index > 0 && SECRET_FLAG.test(argument)) {
      sanitized.push(argument);
      redactNext = true;
      continue;
    }
    sanitized.push(sanitizeArgument(argument));
  }
  return sanitized;
}

function sanitizeFindArguments(args: string[]): string[] {
  const nestedAction = args[3]?.toLowerCase();
  if (!nestedAction) {
    return args.map(sanitizeArgument);
  }
  if (['fill', 'select', 'type'].includes(nestedAction)) {
    return [...args.slice(0, 4).map(sanitizeArgument), REDACTED];
  }
  return args.map(sanitizeArgument);
}

function isKnownCommand(command: string): boolean {
  return (
    HYBRID_ACTIONS.has(command) ||
    OBSERVATION_ACTIONS.has(command) ||
    POINTER_KEYBOARD_ACTIONS.has(command) ||
    SETUP_ACTIONS.has(command) ||
    ['cookies', 'find', 'keyboard', 'network', 'storage'].includes(command)
  );
}

function sanitizeArgument(value: string): string {
  if (URL_SCHEME.test(value)) {
    return sanitizeUrlValue(value);
  }
  return sanitizeDiagnosticMessage(value) || '';
}
