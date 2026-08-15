import { resolveAgentBrowserRuntime } from '../browser/isolation.js';
import type { SessionState } from './state.js';

/**
 * Older registry records predate per-session executable pinning. Resolve the
 * supported runtime once and persist it before issuing another browser command.
 */
export function backfillSessionAgentBrowserRuntime(
  session: SessionState,
): boolean {
  if (
    typeof session.agentBrowserExecutablePath === 'string' &&
    session.agentBrowserExecutablePath.length > 0
  ) {
    return false;
  }

  const runtime = resolveAgentBrowserRuntime();
  session.agentBrowserExecutablePath = runtime.executablePath;
  session.agentBrowserVersion = runtime.version;
  return true;
}
