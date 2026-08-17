#!/usr/bin/env bun
/**
 * CLI entry point + central error boundary. All commands throw; failures —
 * including commander's own parse/usage errors — are normalized here into the
 * error envelope and a stable exit code.
 */

import { CommanderError } from "commander";
import { createProgram, parsedGlobalOptions } from "../cli.js";
import { Output } from "../output/format.js";
import { CliError, normalizeError } from "../lib/errors.js";

const program = createProgram();

program.parseAsync(process.argv).catch((err) => {
  // Help/version are normal terminations that commander already wrote to stdout.
  if (err instanceof CommanderError) {
    if (err.exitCode === 0) process.exit(0);
  }

  const cliError =
    err instanceof CommanderError
      ? new CliError(stripErrorPrefix(err.message), "usage", err.code)
      : normalizeError(err);

  // Format the error the way the user asked for the output — from the globals
  // commander parsed, so every spelling it accepts (`-j`, `-jq`, `--json`)
  // reaches the envelope. Errors go to stderr, so that stream's TTY-ness decides
  // colour, not stdout's.
  const globals = parsedGlobalOptions(program);
  const json = globals.json === true;
  const out = new Output({
    json,
    color: globals.noAnsi !== true && !json && process.stderr.isTTY === true,
    quiet: globals.quiet === true,
    debug: globals.debug === true,
  });
  out.error(cliError);
  process.exit(cliError.exitCode);
});

/** Commander prefixes messages with "error: "; drop it for our envelope. */
function stripErrorPrefix(message: string): string {
  return message.replace(/^error:\s*/i, "");
}
