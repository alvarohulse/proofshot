// Public API
export { createCLI } from './cli.js';
export { installCommand } from './commands/install.js';
export { ensureDevServer } from './server/start.js';
export {
  loadConfig,
  writeConfig,
  type ProofShotConfig,
  type ResolvedProofShotConfig,
} from './utils/config.js';
export { ab, ProofShotError } from './utils/exec.js';
export { isPortOpen, waitForPort } from './utils/port.js';
export type { SessionState } from './session/state.js';
export {
  getRegisteredSession,
  listRegisteredSessions,
  registerSession,
  unregisterSession,
} from './session/registry.js';
export { writeViewer, generateViewer } from './artifacts/viewer.js';
export { writeCanonicalEvidence } from './artifacts/evidence.js';
export type {
  CanonicalEvidence,
  EvidenceIncident,
  EvidenceSourceSummary,
  Verdict,
  VerdictStatus,
} from './artifacts/evidence.js';
export {
  captureGitProvenance,
  loadArtifactManifest,
  validateManifestArtifacts,
  writeArtifactManifest,
} from './session/manifest.js';
export type {
  ArtifactManifest,
  GitProvenance,
  ManifestArtifact,
} from './session/manifest.js';
export type { SessionLogEntry } from './commands/exec.js';
export { convertVideoToMp4, trimVideo } from './commands/stop.js';
export { writeMetadata, loadMetadata, findSessionsForBranch, type SessionMetadata } from './session/metadata.js';
export { formatPRComment, type PRCommentData } from './artifacts/pr-format.js';
export {
  startOwnedEnvironment,
  stopOwnedEnvironment,
} from './environment/runtime.js';
export type {
  EnvironmentConfig,
  EnvironmentState,
  LogsConfig,
  LogSourceConfig,
} from './environment/types.js';
