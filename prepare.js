import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const localTsup = path.join(
  packageDirectory,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsup.cmd' : 'tsup',
);
const builtCli = path.join(packageDirectory, 'dist', 'bin', 'proofshot.js');

if (fs.existsSync(localTsup)) {
  execFileSync(localTsup, [], {
    cwd: packageDirectory,
    stdio: 'inherit',
  });
} else if (fs.existsSync(builtCli)) {
  console.log('Using prebuilt ProofShot distribution.');
} else {
  throw new Error(
    'ProofShot needs either its prebuilt dist files or local tsup tooling.',
  );
}
