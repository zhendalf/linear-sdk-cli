/**
 * Root commander program: registers global options and all command groups.
 * Kept free of side effects so it can be imported by tests and the bin entry.
 */

import { Command } from "commander";
import { addGlobalOptions, globalOptionKeys } from "./lib/options.js";
import { registerMeta } from "./commands/meta.js";
import { registerApi } from "./commands/api.js";
import { registerCompletion } from "./commands/completion.js";
import { registerIssue, renderIssueDetail } from "./commands/issue.js";
import { registerTeam } from "./commands/team.js";
import { registerProject } from "./commands/project.js";
import { registerProjectUpdate } from "./commands/project-update.js";
import { registerMilestone } from "./commands/milestone.js";
import { registerCycle } from "./commands/cycle.js";
import { registerUser } from "./commands/user.js";
import { registerLabel } from "./commands/label.js";
import { registerState } from "./commands/state.js";
import { registerComment } from "./commands/comment.js";
import { registerDocument } from "./commands/document.js";
import { registerAttachment } from "./commands/attachment.js";
import { registerFavorite } from "./commands/favorite.js";
import { registerInitiative } from "./commands/initiative.js";
import { registerInitiativeUpdate } from "./commands/initiative-update.js";
import { registerRoadmap } from "./commands/roadmap.js";
import { registerNotification } from "./commands/notification.js";
import { registerOrganization } from "./commands/organization.js";
import { registerWebhook } from "./commands/webhook.js";
import { registerCommands, registerSchema } from "./commands/discover.js";
import { Context, type GlobalOptions } from "./context.js";
import { currentIssueId } from "./git.js";
import { getIssueDetail } from "./services/issue.js";
import { usageError } from "./lib/errors.js";

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
  // Phase 1: issues.
  registerIssue(program);
  // Phase 2: teams, projects, milestones, cycles.
  registerTeam(program);
  registerProject(program);
  registerProjectUpdate(program);
  registerMilestone(program);
  registerCycle(program);
  // Phase 3: users, labels, workflow states, comments, documents, attachments, favorites.
  registerUser(program);
  registerLabel(program);
  registerState(program);
  registerComment(program);
  registerDocument(program);
  registerAttachment(program);
  registerFavorite(program);
  // Phase 4: initiatives, roadmaps, notifications, organization, webhooks.
  registerInitiative(program);
  registerInitiativeUpdate(program);
  registerRoadmap(program);
  registerNotification(program);
  registerOrganization(program);
  registerWebhook(program);

  // Discovery commands need the fully-built program tree, so register them last.
  registerCommands(program);
  registerSchema(program);

  // Bare `linear` (no subcommand): show the current branch's issue if one can
  // be inferred. With no inferable id: human mode shows help; --json fails with
  // a usage error (so a bare `linear --json` never emits non-JSON to stdout).
  // When an id IS inferred, the output matches `issue view <id>` exactly.
  program.action(async (_opts: unknown, command: Command) => {
    const ctx = new Context(command.optsWithGlobals() as GlobalOptions);
    const id = currentIssueId();
    if (!id) {
      if (ctx.output.json) {
        throw usageError(
          "No issue id inferred from the current branch. Pass an issue id or run `linear --help`.",
        );
      }
      command.help();
      return;
    }
    const detail = await getIssueDetail(ctx.client, id);
    await renderIssueDetail(ctx, detail, false);
  });

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

/**
 * The global options as commander actually parsed them, read back off the
 * command tree after `parseAsync` has thrown.
 *
 * The error boundary has no Context to ask — the failure may have happened
 * before any action ran — so it used to re-parse `process.argv` by hand with
 * `argv.includes("--json")`. That check did not know the `-j` alias, bundled
 * short flags (`-jq`) or any other spelling commander accepts, so `linear issue
 * view NOPE-1 -j` printed a plaintext error while `--json` printed the
 * envelope: an unparseable error stream for exactly the callers the envelope
 * exists for. Commander has already parsed whatever it got to before failing
 * (a bad option is reported only after the whole argument list is scanned), so
 * the boundary reads that instead of parsing again. Every global is registered
 * on every command and stored under the same key, so the flag is found
 * wherever on the command path it was given.
 */
export function parsedGlobalOptions(program: Command): GlobalOptions {
  const keys = globalOptionKeys();
  const merged: Record<string, unknown> = {};
  const visit = (cmd: Command): void => {
    for (const key of keys) {
      if (cmd.getOptionValueSource(key) === "cli") merged[key] = cmd.getOptionValue(key);
    }
    for (const sub of cmd.commands) visit(sub);
  };
  visit(program);
  return merged as GlobalOptions;
}

function applyGlobalOptionsToAll(cmd: Command): void {
  for (const sub of cmd.commands) {
    // addGlobalOptions skips any global the command already declares itself, so
    // this is idempotent and never clobbers a command-specific version (the
    // repeatable `--team` on the issue queries).
    addGlobalOptions(sub);
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
