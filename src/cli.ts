/**
 * Root commander program: registers global options and all command groups.
 * Kept free of side effects so it can be imported by tests and the bin entry.
 */

import { Command, Option } from "commander";
import { addGlobalOptions, globalOptionKeys, unknownCommand, commandPath } from "./lib/options.js";
import { registerMeta } from "./commands/meta.js";
import { registerApi } from "./commands/api.js";
import { registerCompletion } from "./commands/completion.js";
import { registerIssue, renderIssueDetail } from "./commands/issue.js";
import { registerAgentSession } from "./commands/agent-session.js";
import { registerAttach } from "./commands/attach.js";
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
import { registerCustomView } from "./commands/custom-view.js";
import { registerOpen } from "./commands/open.js";
import { registerCommands, registerSchema } from "./commands/discover.js";
import { Context, type GlobalOptions } from "./context.js";
import { currentIssueId } from "./git.js";
import { getIssueDetail } from "./services/issue.js";
import { usageError } from "./lib/errors.js";
import packageJson from "../package.json" with { type: "json" };

/** One version source for the package, both binaries, and programmatic use. */
export const VERSION = packageJson.version;

export function createProgram(): Command {
  const program = new Command();

  program
    .name("linear")
    .description("Ergonomic command-line interface for Linear, built on @linear/sdk")
    .version(VERSION, "-V, --version", "output the version number")
    .enablePositionalOptions()
    // A stray word at the root is an unknown command, and the root action says
    // so (with a guess). Left to commander it was "too many arguments. Expected
    // 0 arguments but got 2: issues, list." — true, and no help at all.
    .allowExcessArguments();

  program.addHelpText(
    "after",
    [
      "",
      "Start here:",
      "  linear auth status                    # check your connection",
      "  linear auth login                     # connect if needed",
      "  linear team list                      # find your team key",
      "  linear issue list --assignee me        # find your work",
      "  linear issue view TES-42               # read an issue",
      "  linear issue list --help               # discover filters and examples",
      "  linear commands issue list --json     # inspect options and JSON fields",
    ].join("\n"),
  );

  addGlobalOptions(program);

  // Phase 0: meta + escape hatch + completion.
  registerMeta(program);
  registerApi(program);
  registerCompletion(program);
  registerOpen(program);
  // Phase 1: issues. Agent sessions live on issues, so their group is mounted
  // under `issue` (`linear issue agent-session …`); so is file upload
  // (`linear issue attach <issue> <file...>`, TES-602).
  registerIssue(program);
  registerAgentSession(program.commands.find((c) => c.name() === "issue")!);
  registerAttach(program.commands.find((c) => c.name() === "issue")!);
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
  registerCustomView(program);

  // Discovery commands need the fully-built program tree, so register them last.
  registerCommands(program);
  registerSchema(program);

  // Bare `linear` (no subcommand): show the current branch's issue if one can
  // be inferred. With no inferable id: human mode shows help; --json fails with
  // a usage error (so a bare `linear --json` never emits non-JSON to stdout).
  // When an id IS inferred, the output matches `issue view <id>` exactly.
  program.action(async (_opts: unknown, command: Command) => {
    if (command.args.length > 0) throw unknownCommand(command, command.args[0]!);
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
    await renderIssueDetail(ctx, detail, true);
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
 * The error boundary has no Context to ask because an option parser may fail
 * before an action runs. Read explicitly supplied globals across the tree;
 * errorGlobalOptions supplements these when trailing flags were not reached.
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

/** Recover output flags after a value parser stops before reaching trailing flags.
 * Parse a side-effect-free copy of the grammar: no actions, hooks, validation,
 * credentials, or API calls. Commander still handles option values, clusters,
 * aliases and `--`, so literal body text cannot turn on JSON mode.
 */
export function errorGlobalOptions(program: Command, args: string[]): GlobalOptions {
  const copy = (source: Command): Command => {
    const cmd = new Command(source.name())
      .aliases(source.aliases())
      .allowExcessArguments()
      .allowUnknownOption()
      .helpOption(false)
      .exitOverride()
      .configureOutput({ writeOut: () => {}, writeErr: () => {} })
      .action(() => {});
    for (const option of source.options) {
      cmd.addOption(new Option(option.flags, option.description));
    }
    for (const child of source.commands) cmd.addCommand(copy(child));
    return cmd;
  };
  const grammar = copy(program).enablePositionalOptions();
  try {
    grammar.parse(args, { from: "user" });
  } catch {
    // Missing option values may still stop parsing; retain whatever was read.
  }
  return { ...parsedGlobalOptions(grammar), ...parsedGlobalOptions(program) };
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

/**
 * The commands whose own parse failed, so the boundary can point at the right
 * `--help`. Commander calls `outputError` on the command that detected the
 * problem, synchronously, just before it throws — that is the only place the
 * failing command is known, since `CommanderError` does not carry it.
 * `.showHelpAfterError()` used to be configured for this and did nothing: the
 * suppressed `writeErr` below swallowed the help it would have printed.
 */
const failedCommands = new WeakSet<Command>();

/**
 * What commander wrote to stderr for a command — help, when a group is
 * invoked bare. `linear notification` used to print `error: (outputHelp)` and
 * nothing else: commander sends the group's help to `writeErr` and asks for a
 * non-zero exit, and `writeErr` was a no-op. The boundary prints this instead.
 */
const suppressedStderr = new WeakMap<Command, string>();

function configureErrorHandling(cmd: Command): void {
  cmd.exitOverride();
  // Route commander's stderr through here rather than to the terminal: the
  // boundary decides what to print (the envelope, or the buffered help).
  // Help/version requested by the user use writeOut (stdout) and are intact.
  cmd.configureOutput({
    writeErr: (str) => {
      suppressedStderr.set(cmd, (suppressedStderr.get(cmd) ?? "") + str);
    },
    outputError: () => {
      failedCommands.add(cmd);
    },
  });
  for (const sub of cmd.commands) configureErrorHandling(sub);
}

/** The command that last wrote to (suppressed) stderr, and what it wrote. */
export function suppressedHelp(program: Command): { command: Command; text: string } | undefined {
  const find = (cmd: Command): { command: Command; text: string } | undefined => {
    for (const sub of cmd.commands) {
      const hit = find(sub);
      if (hit) return hit;
    }
    const text = suppressedStderr.get(cmd);
    return text ? { command: cmd, text } : undefined;
  };
  return find(program);
}

/**
 * `Run 'linear issue create --help' for usage.` for the command whose parse
 * failed, or nothing if none did (an error thrown by an action is not a parse
 * error and needs no such hint).
 */
export function usageHint(program: Command): string | undefined {
  const find = (cmd: Command): Command | undefined => {
    if (failedCommands.has(cmd)) return cmd;
    for (const sub of cmd.commands) {
      const hit = find(sub);
      if (hit) return hit;
    }
    return undefined;
  };
  const failed = find(program);
  return failed ? `Run '${commandPath(failed)} --help' for usage.` : undefined;
}
