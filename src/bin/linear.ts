#!/usr/bin/env node
/**
 * CLI entry point + central error boundary. All commands throw; failures —
 * including commander's own parse/usage errors — are normalized here into the
 * error envelope and a stable exit code.
 */

import { CommanderError } from "commander";
import { createProgram } from "../cli.js";
import { Output } from "../output/format.js";
import { CliError, normalizeError } from "../lib/errors.js";

async function main(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  // Help/version are normal terminations that commander already wrote to stdout.
  if (err instanceof CommanderError) {
    if (err.exitCode === 0) process.exit(0);
  }

  const cliError =
    err instanceof CommanderError
      ? new CliError(stripErrorPrefix(err.message), "usage", err.code)
      : normalizeError(err);

  // Best-effort flags from argv so error formatting respects --json/--debug even
  // when the failure happened during parsing.
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const debug = argv.includes("--debug");
  const color = !argv.includes("--no-color") && process.stderr.isTTY === true && !json;
  const out = new Output({ json, color, quiet: false, debug });
  out.error(cliError);
  process.exit(cliError.exitCode);
});

/** Commander prefixes messages with "error: "; drop it for our envelope. */
function stripErrorPrefix(message: string): string {
  return message.replace(/^error:\s*/i, "");
}
