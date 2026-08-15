import {
  assertAgentBrowserRuntime,
  resolveAgentBrowserRuntime,
  resolveAgentBrowserRuntimeAtPath,
  type AgentBrowserRuntime,
} from '../browser/isolation.js';
import type { SessionState } from './state.js';

/**
 * Older registry records predate per-session executable pinning. Resolve the
 * supported runtime once and persist it before issuing another browser command.
 */
export function backfillSessionAgentBrowserRuntime(
  session: SessionState,
): boolean {
  const executablePath = session.agentBrowserExecutablePath;
  if (typeof executablePath !== 'string' || executablePath.length === 0) {
    return persistRuntime(session, resolveAgentBrowserRuntime());
  }

  if (
    typeof session.agentBrowserExecutableSha256 !== 'string' ||
    typeof session.agentBrowserVersion !== 'string'
  ) {
    return persistRuntime(
      session,
      resolveAgentBrowserRuntimeAtPath(executablePath, process.env),
    );
  }

  assertAgentBrowserRuntime({
    executablePath,
    sha256: session.agentBrowserExecutableSha256,
    version: session.agentBrowserVersion,
  });
  return false;
}

function persistRuntime(
  session: SessionState,
  runtime: AgentBrowserRuntime,
): true {
  session.agentBrowserExecutablePath = runtime.executablePath;
  session.agentBrowserExecutableSha256 = runtime.sha256;
  session.agentBrowserVersion = runtime.version;
  return true;
}
