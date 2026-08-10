import chalk from 'chalk';
import { createCLI } from '../src/cli.js';

const program = createCLI();
program.parseAsync().catch((error) => {
  console.error(
    chalk.red('✗') + ` ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
