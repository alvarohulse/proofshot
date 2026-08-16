import * as fs from 'fs';
import * as path from 'path';

export interface PageResult {
  page: string;
  title: string;
  url: string;
  screenshotPath: string;
  snapshot: string;
  errors: string;
  consoleOutput: string;
}

export interface VerificationResult {
  pageResults: PageResult[];
  videoPath: string | null;
  outputDir: string;
  timestamp: string;
  framework: string;
  port: number;
  serverAlreadyRunning: boolean;
  durationMs: number;
}

type ResolvedDirectoryPath = {
  canonicalPath: string;
  existingPath: string;
  existingStat: fs.Stats;
  missingComponents: string[];
};

/**
 * Ensure the output directory exists and return its canonical safe path.
 */
export function ensureOutputDir(outputDir: string): string {
  const resolvedPath = resolveDirectoryPath(outputDir);
  let directoryPath = resolvedPath.existingPath;
  let directoryDescriptor = openStableDirectory(
    resolvedPath.existingPath,
    resolvedPath.existingStat,
  );

  try {
    for (const component of resolvedPath.missingComponents) {
      const childPath = descriptorChildPath(
        directoryDescriptor,
        directoryPath,
        component,
      );
      fs.mkdirSync(childPath, { mode: 0o700 });
      const childDescriptor = fs.openSync(childPath, directoryOpenFlags());
      try {
        if (process.platform !== 'win32') {
          fs.fchmodSync(childDescriptor, 0o700);
        }
        assertPrivateDirectory(
          fs.fstatSync(childDescriptor),
          path.join(directoryPath, component),
        );
      } catch (error) {
        fs.closeSync(childDescriptor);
        throw error;
      }

      fs.closeSync(directoryDescriptor);
      directoryDescriptor = childDescriptor;
      directoryPath = path.join(directoryPath, component);
    }

    const directoryStat = fs.fstatSync(directoryDescriptor);
    assertPrivateDirectory(directoryStat, directoryPath);
    fs.accessSync(
      directoryPath,
      fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK,
    );
    assertStableDirectoryPath(directoryPath, directoryStat);
    return directoryPath;
  } finally {
    fs.closeSync(directoryDescriptor);
  }
}

function resolveDirectoryPath(outputDir: string): ResolvedDirectoryPath {
  const requestedPath = path.resolve(outputDir);
  const root = path.parse(requestedPath).root;
  const relativePath = path.relative(root, requestedPath);
  const components = relativePath === '' ? [] : relativePath.split(path.sep);
  let existingPath = root;
  let existingStat = fs.lstatSync(root);

  for (const [index, component] of components.entries()) {
    const componentPath = path.join(existingPath, component);
    const componentStat = fs.lstatSync(componentPath, {
      throwIfNoEntry: false,
    });
    if (componentStat === undefined) {
      const missingComponents = components.slice(index);
      return {
        canonicalPath: path.join(existingPath, ...missingComponents),
        existingPath,
        existingStat,
        missingComponents,
      };
    }
    if (componentStat.isSymbolicLink()) {
      const isLeaf = index === components.length - 1;
      if (isLeaf || !isTrustedSystemAlias(componentStat, existingStat)) {
        throw new Error(
          `ProofShot output path component must be a real directory: ${componentPath}`,
        );
      }
      const canonicalAliasPath = fs.realpathSync(componentPath);
      const canonicalAliasStat = fs.lstatSync(canonicalAliasPath);
      if (
        !path.isAbsolute(canonicalAliasPath) ||
        !canonicalAliasStat.isDirectory() ||
        canonicalAliasStat.isSymbolicLink()
      ) {
        throw new Error(
          `ProofShot output system alias must resolve to a real directory: ${componentPath}`,
        );
      }
      existingPath = canonicalAliasPath;
      existingStat = canonicalAliasStat;
      continue;
    }
    if (!componentStat.isDirectory()) {
      throw new Error(
        `ProofShot output path component must be a real directory: ${componentPath}`,
      );
    }
    existingPath = componentPath;
    existingStat = componentStat;
  }

  return {
    canonicalPath: existingPath,
    existingPath,
    existingStat,
    missingComponents: [],
  };
}

function isTrustedSystemAlias(aliasStat: fs.Stats, parentStat: fs.Stats): boolean {
  return (
    aliasStat.uid === 0 &&
    parentStat.uid === 0 &&
    (parentStat.mode & 0o022) === 0
  );
}

function openStableDirectory(directoryPath: string, expectedStat: fs.Stats): number {
  const directoryDescriptor = fs.openSync(directoryPath, directoryOpenFlags());
  const directoryStat = fs.fstatSync(directoryDescriptor);
  if (
    !directoryStat.isDirectory() ||
    directoryStat.dev !== expectedStat.dev ||
    directoryStat.ino !== expectedStat.ino
  ) {
    fs.closeSync(directoryDescriptor);
    throw new Error(`ProofShot output directory changed during validation: ${directoryPath}`);
  }
  return directoryDescriptor;
}

function directoryOpenFlags(): number {
  return (
    fs.constants.O_RDONLY |
    (fs.constants.O_DIRECTORY ?? 0) |
    (fs.constants.O_NOFOLLOW ?? 0)
  );
}

function descriptorChildPath(
  directoryDescriptor: number,
  directoryPath: string,
  component: string,
): string {
  if (process.platform === 'linux') {
    return path.join('/proc/self/fd', String(directoryDescriptor), component);
  }
  // Node exposes descriptor-relative traversal only on Linux. Darwin and Windows
  // can detect, but cannot prevent, a same-UID parent replacement during mkdir.
  return path.join(directoryPath, component);
}

function assertPrivateDirectory(directoryStat: fs.Stats, outputDir: string): void {
  if (!directoryStat.isDirectory()) {
    throw new Error(`ProofShot output must be a real directory: ${outputDir}`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && directoryStat.uid !== uid) {
    throw new Error(`ProofShot output must be owned by the current user: ${outputDir}`);
  }
  if (uid !== undefined && (directoryStat.mode & 0o777) !== 0o700) {
    throw new Error(
      `ProofShot output must already be private; refusing to change permissions: ${outputDir}`,
    );
  }
}

function assertStableDirectoryPath(outputDir: string, descriptorStat: fs.Stats): void {
  const resolvedPath = resolveDirectoryPath(outputDir);
  if (
    resolvedPath.missingComponents.length > 0 ||
    resolvedPath.canonicalPath !== outputDir ||
    resolvedPath.existingStat.dev !== descriptorStat.dev ||
    resolvedPath.existingStat.ino !== descriptorStat.ino
  ) {
    throw new Error(`ProofShot output directory changed during validation: ${outputDir}`);
  }
}

/**
 * Slugify a page path for use in filenames.
 * "/" -> "home", "/dashboard" -> "dashboard", "/settings/profile" -> "settings-profile"
 */
export function slugifyPage(pagePath: string): string {
  if (pagePath === '/' || pagePath === '') return 'home';
  return pagePath
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '');
}

/**
 * Generate a timestamp string for filenames.
 */
export function generateTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/**
 * Generate a session folder name from timestamp and optional description.
 * e.g. "2026-02-27_14-22-09_verify-settings-page" or "2026-02-27_14-22-09"
 */
export function generateSessionDirName(timestamp: string, description: string | null): string {
  if (!description) return timestamp;
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return slug ? `${timestamp}_${slug}` : timestamp;
}

/**
 * Count interactive elements from a snapshot string.
 */
export function countInteractiveElements(snapshot: string): {
  buttons: number;
  links: number;
  forms: number;
  inputs: number;
} {
  const buttons = (snapshot.match(/button/gi) || []).length;
  const links = (snapshot.match(/link|<a /gi) || []).length;
  const forms = (snapshot.match(/form/gi) || []).length;
  const inputs = (snapshot.match(/input|textbox|textarea/gi) || []).length;
  return { buttons, links, forms, inputs };
}

/**
 * Count console errors from the errors string.
 */
export function countErrors(errors: string): number {
  if (!errors || errors.trim() === '' || errors.trim() === 'No errors') return 0;
  return errors.split('\n').filter((line) => line.trim()).length;
}

/**
 * Count console warnings from console output.
 */
export function countWarnings(consoleOutput: string): number {
  if (!consoleOutput) return 0;
  return (consoleOutput.match(/warn/gi) || []).length;
}

/**
 * Get all artifact file paths in the output directory.
 */
export function listArtifacts(outputDir: string): string[] {
  if (!fs.existsSync(outputDir)) return [];
  return fs.readdirSync(outputDir).map((f) => path.join(outputDir, f));
}
