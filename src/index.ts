/**
 * Programmatic entry point. Lets the CLI be embedded/tested without spawning.
 */

export { createProgram, VERSION } from "./cli.js";
export { Context } from "./context.js";
export { resolveConfig, type ResolvedConfig } from "./config.js";
export { createClient } from "./client.js";
export { CliError, ExitCode, normalizeError } from "./lib/errors.js";
export { branchToIssueId, currentIssueId } from "./git.js";
