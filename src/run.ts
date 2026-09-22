/**
 * Punkt wejścia CLI.
 * Faza 7: jedna komenda uruchamia pełny pipeline + obsługa błędów.
 */

import { pathToFileURL } from 'node:url';
import { runPhase7Cli, type RunCliOptions } from './phase7.js';

export interface GenerateCliDeps {
  runPhase7Cli?: (options?: RunCliOptions) => Promise<void>;
  phase7Options?: RunCliOptions;
}

/** Delegacja do `runPhase7Cli` — testowalny entry point `npm run generate`. */
export async function runGenerateCli(deps: GenerateCliDeps = {}): Promise<void> {
  const cli = deps.runPhase7Cli ?? runPhase7Cli;
  await cli(deps.phase7Options);
}

const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await runGenerateCli();
}
