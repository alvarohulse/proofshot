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
  if (session.agentBrowserRuntime) {
    assertAgentBrowserRuntime(session.agentBrowserRuntime);
    return false;
  }
  const executablePath = session.agentBrowserExecutablePath;
  if (typeof executablePath !== 'string' || executablePath.length === 0) {
    return persistRuntime(session, resolveAgentBrowserRuntime());
  }
  const runtime = resolveAgentBrowserRuntimeAtPath(executablePath, process.env);
  if (
    (session.agentBrowserExecutableSha256 &&
      session.agentBrowserExecutableSha256 !== runtime.sha256) ||
    (session.agentBrowserVersion && session.agentBrowserVersion !== runtime.version)
  ) {
    throw new Error(
      'The pinned agent-browser executable changed after this ProofShot session started.',
    );
  }
  return persistRuntime(session, runtime);
}

function persistRuntime(
  session: SessionState,
  runtime: AgentBrowserRuntime,
): true {
  session.agentBrowserExecutablePath = runtime.executablePath;
  session.agentBrowserExecutableSha256 = runtime.sha256;
  session.agentBrowserVersion = runtime.version;
  session.agentBrowserRuntime = runtime;
  return true;
}
