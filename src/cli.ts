/**
 * Root commander program: registers global options and all command groups.
 * Kept free of side effects so it can be imported by tests and the bin entry.
 */

import { Command } from "commander";
import { addGlobalOptions } from "./lib/options.js";
import { registerMeta } from "./commands/meta.js";
import { registerApi } from "./commands/api.js";
import { registerCompletion } from "./commands/completion.js";
import { registerIssue } from "./commands/issue.js";
import { registerTeam } from "./commands/team.js";
import { registerProject } from "./commands/project.js";
import { registerMilestone } from "./commands/milestone.js";
import { registerCycle } from "./commands/cycle.js";
import { registerUser } from "./commands/user.js";
import { registerLabel } from "./commands/label.js";
import { registerState } from "./commands/state.js";
import { registerComment } from "./commands/comment.js";
import { registerDocument } from "./commands/document.js";
import { registerAttachment } from "./commands/attachment.js";
import { registerFavorite } from "./commands/favorite.js";
import { Context, type GlobalOptions } from "./context.js";
import { currentIssueId } from "./git.js";
import { getIssueDetail } from "./services/issue.js";

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

  // Bare `linear` (no subcommand): show the current branch's issue if one can
  // be inferred, otherwise help.
  program.action(async (_opts: unknown, command: Command) => {
    const id = currentIssueId();
    if (!id) {
      command.help();
      return;
    }
    const ctx = new Context(command.optsWithGlobals() as GlobalOptions);
    const d = await getIssueDetail(ctx.client, id);
    ctx.output.detail(d, [
      ["Issue", `${d.identifier}  ${d.title}`],
      ["State", d.state],
      ["Assignee", d.assignee],
      ["URL", d.url],
    ]);
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
