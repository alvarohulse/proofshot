/**
 * Render an error's own message, without its causes.
 */
export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Render an error for the CLI, naming every nested cause.
 *
 * Cleanup collects independent failures into an `AggregateError` whose message is
 * only a summary, so the actionable causes live in `errors` and have to be spelled
 * out or the user is told to resolve a problem that was never named.
 */
export function formatErrorDetail(error: unknown, indent = '  '): string {
  const summary = formatError(error);
  const causes = error instanceof AggregateError ? error.errors : [];
  if (!Array.isArray(causes) || causes.length === 0) {
    return summary;
  }
  return (
    summary +
    causes
      .map((cause) => `\n${indent}- ${formatErrorDetail(cause, `${indent}  `)}`)
      .join('')
  );
}
