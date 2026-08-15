const REDACTED = '[REDACTED]';
const SECRET_FLAG = /^(?:--)?(?:authorization|cookie|credential|password|secret|token|api[-_]?key|body)$/i;
const SECRET_QUERY_PARAMETER = /(?:auth|code|cookie|credential|key|password|secret|session|token)/i;

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
  if (
    [
      'assert-visible',
      'console',
      'errors',
      'get',
      'is',
      'read',
      'screenshot',
      'snapshot',
    ].includes(command)
  ) {
    return 'observation';
  }
  if (
    ['click', 'dblclick', 'drag', 'hover', 'key', 'mouse', 'press'].includes(
      command,
    )
  ) {
    return 'pointer-keyboard';
  }
  if (['check', 'fill', 'select', 'type', 'uncheck'].includes(command)) {
    return 'hybrid';
  }
  if (command === 'eval') {
    return 'synthetic-dom';
  }
  if (
    [
      'close',
      'cookies',
      'find',
      'navigate',
      'network',
      'open',
      'record',
      'set',
      'storage',
      'tab',
      'upload',
      'wait',
    ].includes(command)
  ) {
    return 'setup';
  }
  return 'unknown';
}

export function sanitizePageUrl(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of url.searchParams.keys()) {
      if (SECRET_QUERY_PARAMETER.test(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }
    return url.toString();
  } catch {
    return sanitizeDiagnosticMessage(value);
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
    .replace(/https?:\/\/[^\s"']+/g, (url) => sanitizePageUrl(url) || REDACTED);
}

function sanitizeArguments(command: string, args: string[]): string[] {
  if (command === 'eval') {
    return [command, '[REDACTED_SCRIPT]'];
  }
  if (['fill', 'type'].includes(command)) {
    return [command, sanitizeArgument(args[1] || ''), REDACTED];
  }
  if (command === 'set' && ['credentials', 'headers'].includes(args[1]?.toLowerCase())) {
    return [command, args[1].toLowerCase(), REDACTED];
  }
  if (command === 'cookies' && args[1]?.toLowerCase() === 'set') {
    return [command, 'set', sanitizeArgument(args[2] || ''), REDACTED];
  }
  if (command === 'upload') {
    return [command, sanitizeArgument(args[1] || ''), '[LOCAL_FILE]'];
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

function sanitizeArgument(value: string): string {
  const url = sanitizePageUrl(value);
  if (url !== value) {
    return url || REDACTED;
  }
  return sanitizeDiagnosticMessage(value) || '';
}
