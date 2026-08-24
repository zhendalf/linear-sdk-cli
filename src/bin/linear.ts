#!/usr/bin/env bun
/**
 * CLI entry point + central error boundary. All commands throw; failures —
 * including commander's own parse/usage errors — are normalized here into the
 * error envelope and a stable exit code.
 */

import { CommanderError } from "commander";
import { createProgram, parsedGlobalOptions, usageHint, suppressedHelp } from "../cli.js";
import { Output } from "../output/format.js";
import { CliError, ExitCode, normalizeError } from "../lib/errors.js";
import { commandPath } from "../lib/options.js";
import { isDebugEnabled, shouldUseColor } from "../output/color.js";

// `linear schema | head -2` is a reader that stops early, and stdout closing
// under us is that reader's business, not an error: exit quietly, as every
// well-behaved Unix filter does. Without a listener Bun surfaces the EPIPE as
// an unhandled stream error — a raw stack dump on stderr and exit 1.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
}

const program = createProgram();

program.parseAsync(process.argv).catch((err) => {
  // Help/version are normal terminations that commander already wrote to stdout.
  if (err instanceof CommanderError) {
    if (err.exitCode === 0) process.exit(0);
  }

  // A group invoked bare (`linear notification`) is commander asking to show
  // that group's help and exit non-zero. It wrote the help to the stderr we
  // route through here, so print exactly that for a human — an envelope
  // wrapping thirty lines of usage is not an error message — and the one-line
  // usage error under --json.
  if (err instanceof CommanderError && err.code === "commander.help") {
    const help = suppressedHelp(program);
    if (help && parsedGlobalOptions(program).json !== true) {
      process.stderr.write(help.text);
      process.exit(ExitCode.Usage);
    }
  }

  const cliError = err instanceof CommanderError ? fromCommander(err) : normalizeError(err);

  // Format the error the way the user asked for the output — from the globals
  // commander parsed, so every spelling it accepts (`-j`, `-jq`, `--json`)
  // reaches the envelope. Errors go to stderr, so that stream's TTY-ness decides
  // colour, not stdout's.
  const globals = parsedGlobalOptions(program);
  const json = globals.json === true;
  const out = new Output({
    json,
    color: shouldUseColor({
      disabled: globals.noAnsi,
      json,
      isTTY: process.stderr.isTTY === true,
    }),
    quiet: globals.quiet === true,
    debug: isDebugEnabled(globals.debug),
    isTTY: process.stderr.isTTY === true,
  });
  out.error(cliError);
  process.exit(cliError.exitCode);
});

/**
 * Commander's own failures as CliErrors. A parse failure gets a pointer at the
 * failing command's `--help` — the string form of what `.showHelpAfterError()`
 * would print, if commander's stderr were not routed through here.
 */
function fromCommander(err: CommanderError): CliError {
  if (err.code === "commander.help") {
    const help = suppressedHelp(program);
    const path = help ? commandPath(help.command) : "linear";
    return new CliError(
      "Missing subcommand.",
      "usage",
      err.code,
      `Run '${path} --help' to see the commands.`,
    );
  }
  return new CliError(
    stripErrorPrefix(err.message).replace(/\.?$/, "."),
    "usage",
    err.code,
    usageHint(program),
  );
}

/** Commander prefixes messages with "error: "; drop it for our envelope. */
function stripErrorPrefix(message: string): string {
  return message.replace(/^error:\s*/i, "");
}
