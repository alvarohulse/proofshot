import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { loadConfigForTeardown } from '../utils/config.js';
import { formatErrorDetail } from '../utils/errors.js';
import { releaseActiveSessionEnvironment } from '../session/teardown.js';

export async function cleanCommand(): Promise<void> {
  const { config, error: configError } = loadConfigForTeardown();
  reportConfigError(configError);
  const outputDir = path.resolve(config.output);

  if (!fs.existsSync(outputDir)) {
    console.log(chalk.dim('Nothing to clean — no artifacts directory found.'));
    return;
  }

  const cleanupError = await releaseActiveSessionEnvironment(outputDir);
  if (cleanupError) {
    console.error(
      chalk.red('✗') +
        ` Refusing to remove ${outputDir}: ${formatErrorDetail(cleanupError)}`,
    );
    console.error(
      chalk.dim(
        '  Recovery state was retained. Resolve the resource issue, then run "proofshot stop" again.',
      ),
    );
    process.exit(1);
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  console.log(chalk.green('✓') + ` Removed ${chalk.dim(outputDir)}`);
}

function reportConfigError(error: Error | null): void {
  if (!error) {
    return;
  }
  console.error(chalk.yellow('⚠') + ` ${error.message}`);
  console.error(
    chalk.dim('  Continuing teardown with the resolvable output directory.'),
  );
}
