const REDACTED = '[REDACTED]';
const SECRET_KEY = /(?:^|[-_])(?:authorization|body|cookie|credentials?|headers?|password|secret|token|api[-_]?key)$/i;

type Assignment = {
  replacement: string;
  valueEnd: number;
  valueStart: number;
};

export function redactDiagnosticAssignments(value: string): string {
  let copyStart = 0;
  let cursor = 0;
  let sanitized = '';
  while (cursor < value.length) {
    const assignment = readSensitiveAssignment(value, cursor);
    if (!assignment) {
      cursor += 1;
      continue;
    }
    sanitized += value.slice(copyStart, assignment.valueStart);
    sanitized += assignment.replacement;
    copyStart = assignment.valueEnd;
    cursor = assignment.valueEnd;
  }
  return sanitized + value.slice(copyStart);
}

function readSensitiveAssignment(
  value: string,
  start: number,
): Assignment | null {
  const key = readKey(value, start);
  if (!key || !isSensitiveKey(key.value)) {
    return null;
  }

  let separator = key.end;
  while (isHorizontalWhitespace(value[separator])) {
    separator += 1;
  }
  if (![':', '='].includes(value[separator] || '')) {
    return null;
  }

  let valueStart = separator + 1;
  while (isWhitespace(value[valueStart])) {
    valueStart += 1;
  }
  if (valueStart >= value.length) {
    return null;
  }

  const first = value[valueStart];
  if (
    first === '\\' &&
    (value[valueStart + 1] === '"' || value[valueStart + 1] === "'")
  ) {
    const quote = value[valueStart + 1];
    return {
      replacement: `\\${quote}${REDACTED}\\${quote}`,
      valueEnd: findEscapedQuotedEnd(value, valueStart),
      valueStart,
    };
  }
  if (first === '"' || first === "'") {
    return {
      replacement: `${first}${REDACTED}${first}`,
      valueEnd: findQuotedEnd(value, valueStart),
      valueStart,
    };
  }
  if (first === '{' || first === '[') {
    return {
      replacement: JSON.stringify(REDACTED),
      valueEnd: findCompositeEnd(value, valueStart),
      valueStart,
    };
  }

  // Free-form values have no reliable intra-line boundary. Folded headers and
  // diagnostic continuations remain part of the field while they are indented.
  return {
    replacement: REDACTED,
    valueEnd: findFreeFormEnd(value, valueStart),
    valueStart,
  };
}

function readKey(
  value: string,
  start: number,
): { end: number; value: string } | null {
  const first = value[start];
  if (
    first === '\\' &&
    (value[start + 1] === '"' || value[start + 1] === "'")
  ) {
    const end = findEscapedQuotedEnd(value, start);
    const hasClosingQuote =
      end > start + 3 &&
      value[end - 2] === '\\' &&
      value[end - 1] === value[start + 1];
    return hasClosingQuote
      ? { end, value: value.slice(start + 2, end - 2) }
      : null;
  }
  if (first === '"' || first === "'") {
    if (start > 0 && value[start - 1] === '\\') {
      return null;
    }
    const end = findQuotedEnd(value, start);
    return end > start + 1 && value[end - 1] === first
      ? { end, value: value.slice(start + 1, end - 1) }
      : null;
  }
  if (!/[A-Za-z0-9_-]/.test(first || '')) {
    return null;
  }
  if (start > 0 && /[A-Za-z0-9_-]/.test(value[start - 1])) {
    return null;
  }
  let end = start;
  while (/[A-Za-z0-9_-]/.test(value[end] || '')) {
    end += 1;
  }
  return { end, value: value.slice(start, end) };
}

function isSensitiveKey(key: string): boolean {
  return SECRET_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, '$1-$2'));
}

function isHorizontalWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/.test(value) && !/[\r\n]/.test(value);
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/.test(value);
}

function findQuotedEnd(value: string, start: number): number {
  const quote = value[start];
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === quote) {
      return index + 1;
    }
  }
  return value.length;
}

function findEscapedQuotedEnd(value: string, start: number): number {
  const quote = value[start + 1];
  for (let index = start + 2; index < value.length - 1; index += 1) {
    if (
      value[index] === '\\' &&
      value[index + 1] === quote &&
      value[index - 1] !== '\\'
    ) {
      return index + 2;
    }
  }
  return value.length;
}

function findFreeFormEnd(value: string, start: number): number {
  let end = findLineEnd(value, start);
  while (end < value.length) {
    let probe = end;
    while (probe < value.length) {
      const nextLineStart = skipLineBreak(value, probe);
      let contentStart = nextLineStart;
      while (isHorizontalWhitespace(value[contentStart])) {
        contentStart += 1;
      }
      const nextLineEnd = findLineEnd(value, contentStart);
      if (contentStart === nextLineEnd) {
        probe = nextLineEnd;
        continue;
      }
      if (contentStart === nextLineStart) {
        return end;
      }
      end = nextLineEnd;
      break;
    }
    if (probe >= value.length) {
      return end;
    }
  }
  return end;
}

function findLineEnd(value: string, start: number): number {
  let end = start;
  while (end < value.length && !/[\r\n]/.test(value[end])) {
    end += 1;
  }
  return end;
}

function skipLineBreak(value: string, start: number): number {
  return value[start] === '\r' && value[start + 1] === '\n'
    ? start + 2
    : start + 1;
}

function findCompositeEnd(value: string, start: number): number {
  const closers = [value[start] === '{' ? '}' : ']'];
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{' || character === '[') {
      closers.push(character === '{' ? '}' : ']');
    } else if (character === closers[closers.length - 1]) {
      closers.pop();
      if (closers.length === 0) {
        return index + 1;
      }
    }
  }
  return value.length;
}
