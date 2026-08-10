import { loadSession, saveSession } from './state.js';
import { stopOwnedEnvironment } from '../environment/runtime.js';

/**
 * Stop the environment recorded in the active session before its state is
 * discarded.
 *
 * `.session.json` is the only record of the owned process and socket identities,
 * so anything that erases it (`start --force`, `clean`) has to release those
 * resources first and keep the recovery state when it cannot. Returns the
 * cleanup failure, or null when there is nothing left to own.
 */
export async function releaseActiveSessionEnvironment(
  outputDir: string,
): Promise<Error | null> {
  const session = loadSession(outputDir);
  if (!session?.environment) {
    return null;
  }
  try {
    await stopOwnedEnvironment(session.environment);
  } catch (error) {
    saveSession(session);
    return error instanceof Error ? error : new Error(String(error));
  }
  session.environment = null;
  saveSession(session);
  return null;
}
