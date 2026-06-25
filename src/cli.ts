/**
 * Root commander program: registers global options and all command groups.
 * Kept free of side effects so it can be imported by tests and the bin entry.
 */

import { Command } from "commander";
import { addGlobalOptions } from "./lib/options.js";
import { registerMeta } from "./commands/meta.js";
import { registerApi } from "./commands/api.js";
import { registerCompletion } from "./commands/completion.js";

export const VERSION = "0.1.0";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("linear")
    .description("Ergonomic command-line interface for Linear, built on @linear/sdk")
    .version(VERSION, "-V, --version", "output the version number")
    .showHelpAfterError()
    .enablePositionalOptions();

  addGlobalOptions(program);

  // Phase 0: meta + escape hatch + completion.
  registerMeta(program);
  registerApi(program);
  registerCompletion(program);

  // Make global options usable in any position (e.g. `linear whoami --json`),
  // not just before the subcommand. Commander's optsWithGlobals() correctly
  // prefers an explicitly-set value over a child default, so this is safe.
  applyGlobalOptionsToAll(program);

  // Route commander's own parse/usage failures through our central error
  // boundary (so they honor the JSON envelope + exit codes) instead of letting
  // commander call process.exit with plain text. Its error text is suppressed;
  // bin/linear.ts re-emits via the Output layer.
  configureErrorHandling(program);

  return program;
}

function applyGlobalOptionsToAll(cmd: Command): void {
  for (const sub of cmd.commands) {
    if (!sub.options.some((o) => o.long === "--json")) addGlobalOptions(sub);
    applyGlobalOptionsToAll(sub);
  }
}

function configureErrorHandling(cmd: Command): void {
  cmd.exitOverride();
  // Suppress commander's stderr writes (errors/usage-after-error). Help/version
  // use writeOut (stdout) and remain intact. The boundary prints the envelope.
  cmd.configureOutput({ writeErr: () => {} });
  for (const sub of cmd.commands) configureErrorHandling(sub);
}
