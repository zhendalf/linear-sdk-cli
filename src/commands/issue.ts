/**
 * `linear issue` (alias `i`) — the core, git-branch-aware command group.
 *
 * When an issue id is omitted, it is inferred from the current git branch
 * (`tes-123-foo` → `TES-123`).
 */

import { Command, Option } from "commander";
import { action } from "../lib/action.js";
import {
  addFilterOptions,
  addCoreFilterOptions,
  addAliasOption,
  readAlias,
  parseList,
  parseIntOption,
  parsePriority,
  collectArray,
  CYCLE_FLAG,
  CYCLE_DESC,
  suggestSubcommand,
} from "../lib/options.js";
import { registerIssueCommentGroup } from "./comment.js";
import { noteWorkspaceWide } from "./project.js";
import { resolveBody } from "../lib/body.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import { usageError } from "../lib/errors.js";
import {
  currentIssueId,
  checkoutBranch,
  isGitRepo,
  buildTrailer,
  buildDescription,
  buildPrContent,
  buildPrArgs,
} from "../git.js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CliError, normalizeError } from "../lib/errors.js";
import { openUrl } from "../lib/open.js";
import type { Context } from "../context.js";
import * as svc from "../services/issue.js";
import * as commentSvc from "../services/comment.js";
import { isSelf, normalizeIssueReference, resolveIssue } from "../lib/resolve.js";
import type { Column } from "../output/table.js";

/** Resolve the target issue id from an argument/current branch, expanding `42` via the default team. */
function requireId(idArg: string | undefined, defaultTeam?: string): string {
  const id = idArg ?? currentIssueId();
  if (!id) {
    throw usageError("No issue id given and none could be inferred from the current branch.");
  }
  return normalizeIssueReference(id, defaultTeam);
}

const ROW_COLUMNS: Column<svc.IssueRow>[] = [
  { key: "id", header: "ID", value: (r) => r.identifier },
  // `--include-archived` mixes live, archived and trashed rows; mark the latter
  // two so they cannot pass for live. The state name alone stays under 14.
  {
    key: "state",
    header: "State",
    value: (r) => `${r.state?.name ?? ""}${lifecycleMark(r)}`,
    max: 26,
  },
  { key: "priority", header: "Pri", value: (r) => shortPriority(r.priority) },
  { key: "assignee", header: "Assignee", value: (r) => r.assignee?.displayName ?? "—", max: 16 },
  { key: "title", header: "Title", value: (r) => r.title, max: 60 },
];

/**
 * Columns the default table leaves out (it is wide already) but `--fields` can
 * ask for by name: `--fields id,milestone,title`. A cycle shows its name, or
 * `#n` when it has none — the generic row-key fallback would print its id.
 */
const EXTRA_COLUMNS: Column<svc.IssueRow>[] = [
  { key: "milestone", header: "Milestone", value: (r) => r.milestone?.name ?? "—", max: 30 },
  { key: "cycle", header: "Cycle", value: (r) => cycleLabel(r.cycle) },
];

/** The list table's columns: the defaults, plus the optional ones once `--fields` is selecting. */
function listColumns(ctx: Context): Column<svc.IssueRow>[] {
  return ctx.options.fields?.length ? [...ROW_COLUMNS, ...EXTRA_COLUMNS] : ROW_COLUMNS;
}

/** `Sprint 3`, or `#3` for an unnamed cycle; `—` for none. */
function cycleLabel(c: svc.IssueRow["cycle"]): string {
  return c ? (c.name ?? `#${c.number}`) : "—";
}

function shortPriority(p: number): string {
  return ["—", "Urgent", "High", "Med", "Low"][p] ?? String(p);
}

/** ` (trashed)` / ` (archived)` for a row that is not live; empty otherwise. */
function lifecycleMark(r: Pick<svc.IssueRow, "trashed" | "archivedAt">): string {
  return r.trashed ? " (trashed)" : r.archivedAt ? " (archived)" : "";
}

/** A removed reference flag whose meaning is already this CLI's query default. */
function addNoopAllAssignees(command: Command): void {
  command.addOption(
    new Option(
      "--all-assignees",
      "accepted for compatibility (does not change the query)",
    ).hideHelp(),
  );
}

/**
 * schpet/linear-cli `issue` subcommands that a migrating user may type and that
 * do not exist under that name here. Since `view` is the default subcommand,
 * `linear issue link x` lands in `view` with "link" as the id; without this
 * the error would only say it is not an issue id. Keep in step with MIGRATING.md.
 * (`issue attach` is a real subcommand now — TES-602 — so it never lands here.)
 */
const SCHPET_ISSUE_SUBCOMMANDS: Record<string, string> = {
  link: "Use 'linear attachment create <issue> --url <url>'.",
  commits:
    "'issue commits' is not available here (jj/git log integration is not adopted). Use 'git log --grep <ID>'.",
  "agent-session": "Use 'linear issue agent-session list|view <issue>'.",
};

export function registerIssue(program: Command): void {
  const issue = program.command("issue").alias("i").description("Work with issues");

  // view --------------------------------------------------------------------
  issue
    .command("view [id]", { isDefault: true })
    .description("Show an issue (defaults to the current branch's issue)")
    .option("-w, --web", "open the issue in the browser instead of printing")
    .option("--app", "open the issue in Linear.app instead of printing")
    .option("--no-comments", "exclude comments from the output")
    // The old opt-in spelling remains accepted; comments are now on by default.
    .addOption(
      new Option(
        "--comments",
        "accepted for compatibility: comments are included by default",
      ).hideHelp(),
    )
    .option("--show-resolved-threads", "include resolved comment threads")
    .action(
      action(async (ctx: Context, opts, idArg?: string) => {
        // `view` is the default subcommand, so `linear issue lst` lands here
        // with "lst" as the id. Say what it probably was, not just what it is not.
        if (idArg !== undefined && !ISSUE_ID_RE.test(idArg)) {
          // A schpet/linear-cli subcommand that lives elsewhere here (or not at
          // all) is the likeliest thing a migrating user types; name the
          // equivalent before falling back to a spelling guess.
          const ported = SCHPET_ISSUE_SUBCOMMANDS[idArg.toLowerCase()];
          const guess = ported ? undefined : suggestSubcommand(issue, idArg);
          throw usageError(
            `'${idArg}' is not a valid issue id (expected e.g. TES-123, 123 with a default team, or a UUID).${
              ported ? ` ${ported}` : guess ? ` Did you mean 'linear issue ${guess}'?` : ""
            }`,
          );
        }
        if (opts.web && opts.app) throw usageError("Pass either --web or --app, not both.");
        const includeComments = opts.comments !== false && !opts.web && !opts.app;
        const detail = await svc.getIssueDetail(ctx.client, requireId(idArg, ctx.defaultTeam), {
          includeComments,
        });
        if (opts.web || opts.app) {
          await openUrl(detail.url, { app: opts.app === true });
          ctx.output.emit(
            { id: detail.id, identifier: detail.identifier, url: detail.url, opened: true },
            () =>
              ctx.output.success(
                `Opened ${detail.identifier} in ${opts.app ? "Linear.app" : "the browser"}`,
              ),
          );
          return;
        }
        await renderIssueDetail(ctx, detail, includeComments, opts.showResolvedThreads === true);
      }),
    );

  // list --------------------------------------------------------------------
  const list = issue
    .command("list")
    .alias("ls")
    // `query` is the reference CLI's name for this command; same code path.
    .alias("query")
    .description("List issues with filters")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear issue list --assignee me --state 'In Progress'",
        "  linear issue list --team TES --team ENG --state started --state 'In Review'",
        "  linear issue list --unassigned --created-after 2026-01-01",
        "  linear issue list --project-label mobile --updated-after 2026-08-01",
        "  linear issue list --cycle current --json | jq -r '.[].identifier'",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts) => {
        // `--all-states` is already how `list` behaves; accepting it keeps
        // transplanted commands working, but pairing it with an explicit
        // --state is a contradiction, so say so rather than pick one.
        if (opts.allStates && opts.state?.length) {
          throw usageError("Pass either --state or --all-states, not both.");
        }
        noteWorkspaceWide(ctx, opts);
        const rows = await svc.listIssues(
          ctx.client,
          {
            team: opts.team ?? ctx.defaultTeam,
            allTeams: opts.allTeams,
            assignee: opts.assignee,
            unassigned: opts.unassigned,
            state: opts.state,
            project: opts.project,
            projectLabel: opts.projectLabel,
            milestone: opts.milestone,
            label: opts.label,
            priority: opts.priority,
            cycle: opts.cycle,
            createdAfter: opts.createdAfter,
            updatedAfter: opts.updatedAfter,
            query: readAlias(opts, "--query", "--search"),
            sort: svc.resolveIssueSort(opts.sort, ctx.config),
            includeArchived: opts.includeArchived,
          },
          ctx.limit,
          ctx.defaultTeam,
        );
        ctx.output.list(rows, listColumns(ctx), rows);
      }),
    );
  addFilterOptions(list).addOption(
    // Not an alias of anything here — `list` already spans every state — but
    // the reference ships it, so accept it as a no-op instead of erroring.
    new Option(
      "--all-states",
      "accepted for compatibility (list is all-states already)",
    ).hideHelp(),
  );
  addNoopAllAssignees(list);

  // mine --------------------------------------------------------------------
  // `list` stays general; `mine` is the opinionated "what's on my plate" view
  // the reference CLI ships as its default listing — same defaults (you, and
  // unstarted work only), so a transplanted `linear issue mine` behaves.
  const mine = issue
    .command("mine")
    // Deliberately NO `l` alias, which is what the reference uses: our `list` is
    // `ls`, so `l` and `ls` would sit one keystroke apart and return completely
    // different sets. `linear issue l` failing loudly is the better outcome.
    .description("List your unstarted issues (--all-states for every state)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear issue mine                       # your unstarted issues",
        "  linear issue mine --all-states          # every state, still yours",
        "  linear issue mine --state started       # one specific state instead",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts) => {
        if (opts.allStates && opts.state?.length) {
          throw usageError("Pass either --state or --all-states, not both.");
        }
        noteWorkspaceWide(ctx, opts);
        const rows = await svc.listIssues(
          ctx.client,
          {
            team: opts.team ?? ctx.defaultTeam,
            allTeams: opts.allTeams,
            // The whole point of the command: never overridable.
            assignee: "me",
            // An explicit --state (repeatable) replaces the default set rather
            // than intersecting it; --all-states drops the restriction entirely.
            state: opts.state?.length
              ? opts.state
              : opts.allStates
                ? undefined
                : svc.MINE_STATE_TYPES,
            project: opts.project,
            projectLabel: opts.projectLabel,
            milestone: opts.milestone,
            label: opts.label,
            priority: opts.priority,
            cycle: opts.cycle,
            createdAfter: opts.createdAfter,
            updatedAfter: opts.updatedAfter,
            query: readAlias(opts, "--query", "--search"),
            sort: svc.resolveIssueSort(opts.sort, ctx.config),
            includeArchived: opts.includeArchived,
          },
          ctx.limit,
          ctx.defaultTeam,
        );
        ctx.output.list(rows, listColumns(ctx), rows);
      }),
    );
  addFilterOptions(mine, { assignee: false }).addOption(
    new Option("--all-states", "include every workflow state, not just unstarted"),
  );
  addNoopAllAssignees(mine);

  // search ------------------------------------------------------------------
  const search = issue
    .command("search <text>")
    .description("Full-text search across issues (scoped to the default team; --all-teams widens)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear issue search 'login crash' --state started",
        "  linear issue search 'login crash' --all-teams --assignee me",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts, text: string) => {
        noteWorkspaceWide(ctx, opts);
        const rows = await svc.searchIssues(
          ctx.client,
          text,
          {
            team: opts.team ?? ctx.defaultTeam,
            allTeams: opts.allTeams,
            assignee: opts.assignee,
            unassigned: opts.unassigned,
            state: opts.state,
            project: opts.project,
            projectLabel: opts.projectLabel,
            milestone: opts.milestone,
            label: opts.label,
            priority: opts.priority,
            cycle: opts.cycle,
            createdAfter: opts.createdAfter,
            updatedAfter: opts.updatedAfter,
            includeArchived: opts.includeArchived,
            searchComments: opts.searchComments,
          },
          ctx.limit,
          ctx.defaultTeam,
        );
        ctx.output.list(rows, listColumns(ctx), rows);
      }),
    );
  // Search-only: the plain `issues` query has nowhere to put it, so this does
  // not belong in the shared filter options.
  addCoreFilterOptions(search).option(
    "--search-comments",
    "match comment bodies as well as titles and descriptions",
  );
  addNoopAllAssignees(search);

  // create ------------------------------------------------------------------
  const create = issue
    .command("create")
    .alias("new")
    .description("Create a new issue")
    .option("--title <title>", "issue title")
    .option("-d, --description <text>", "issue description (body)")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--editor", "compose the description in $EDITOR")
    .option("-a, --assignee <who>", "assignee (me|email|name|id)")
    .option("-s, --state <name>", "workflow state name or type")
    .option("-P, --priority <0-4>", "priority", parsePriority)
    .option("-l, --label <name>", "label (repeatable / comma-separated)", parseList)
    .option("-p, --project <name>", "project name or id")
    .option("--milestone <name>", "project milestone (requires --project)")
    .option(CYCLE_FLAG, CYCLE_DESC)
    .option("--estimate <n>", "estimate points", parseIntOption)
    .option(
      "--parent <id>",
      "parent issue id (the sub-issue joins the parent's project unless --project says otherwise)",
    )
    .option("--due <date>", "due date (YYYY-MM-DD)")
    .option("--template <name|id>", "create from an issue template (the team's or a shared one)")
    .option("--no-default-template", "do not apply the team's default issue template")
    .option(
      "--start",
      "then start work: check out the branch, move to the first 'started' state (or --state), assign to you",
    )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear issue create --title 'Fix login' --team TES --assignee me",
        "  linear issue create --title 'Bug' -l bug -l urgent --priority 1",
        "  linear issue create --title 'Sprint task' --cycle current --state 'In Progress'",
        "  linear issue create --title 'Sub-task' --parent TES-42          # inherits TES-42's project",
        "  linear issue create --title 'Bug report' --template 'Bug'      # from a template",
        "  linear issue create --title 'Hotfix' --start                    # create, branch, In Progress",
        "  linear issue create --title 'API' --team TES --json | jq -r '.identifier'",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts) => {
        // `--start` means *you* are starting on it, so it assigns to you (as the
        // reference CLI does); naming somebody else at the same time is a contradiction.
        if (opts.start && opts.assignee && !isSelf(opts.assignee)) {
          throw usageError(
            "--start assigns the issue to you; pass either --start or --assignee <someone else>, not both.",
          );
        }
        let title: string | undefined = opts.title;
        if (!title) title = await promptInput(ctx, "Title:", { required: true });
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: !!opts.editor && ctx.isTTY,
          editorRequested: !!opts.editor,
        });
        const created = await svc.createIssue(
          ctx.client,
          {
            title,
            description,
            team: opts.team ?? ctx.defaultTeam,
            assignee: opts.start ? (opts.assignee ?? "me") : opts.assignee,
            state: opts.state,
            priority: opts.priority,
            label: opts.label,
            project: opts.project,
            milestone: opts.milestone,
            cycle: opts.cycle,
            estimate: opts.estimate,
            parent: opts.parent ? normalizeIssueReference(opts.parent, ctx.defaultTeam) : undefined,
            dueDate: readAlias(opts, "--due", "--due-date"),
            template: opts.template,
            // Both spellings: ours, and the reference CLI's `--no-use-default-template`.
            useDefaultTemplate: opts.defaultTemplate !== false && opts.useDefaultTemplate !== false,
          },
          ctx.defaultTeam,
        );
        if (!opts.start) {
          ctx.output.emit(
            { id: created.id, identifier: created.identifier, url: created.url },
            () => ctx.output.success(`Created ${created.identifier}: ${created.url}`),
          );
          return;
        }
        // --start: the same two steps `issue start --move` takes, on the issue
        // just created. An explicit --state already put it where it belongs, so
        // only the default case moves it (to the team's first `started` state).
        const moved = !opts.state;
        // Local checkout is the preflight for starting work. If git refuses
        // (dirty tree, invalid ref, …), the issue remains in its existing state.
        const branchResult = isGitRepo() ? checkoutBranch(created.branchName) : undefined;
        await svc.moveIssueState(ctx.client, created, { move: moved });
        ctx.output.emit(
          {
            id: created.id,
            identifier: created.identifier,
            url: created.url,
            branch: branchResult?.branch ?? created.branchName,
            checkedOut: !!branchResult,
            stateChanged: moved,
          },
          () => {
            ctx.output.success(`Created ${created.identifier}: ${created.url}`);
            if (branchResult)
              ctx.output.success(
                `${branchResult.created ? "Created and checked out" : "Checked out"} ${branchResult.branch}`,
              );
            else ctx.output.info(`Branch name: ${created.branchName}`);
            if (moved) ctx.output.success(`Moved ${created.identifier} → started`);
          },
        );
      }),
    );
  addAliasOption(create, "--due-date <date>", "--due");
  addAliasOption(create, "--no-use-default-template", "--no-default-template");

  // update ------------------------------------------------------------------
  const update = issue
    .command("update [id]")
    .alias("edit")
    .description("Update an issue")
    .option("--title <title>", "new title")
    .option("-d, --description <text>", "new description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    // Declared locally so help says what `--team` *does here* — this is the one
    // command where the global team flag moves the issue instead of scoping a
    // lookup. (addGlobalOptions leaves a locally-declared global alone.)
    .option("-t, --team <key>", "move the issue to another team (changes its identifier)")
    .option("-a, --assignee <who>", "assignee (me|email|name|id)")
    .option("-s, --state <name>", "workflow state name or type")
    .option("-P, --priority <0-4>", "priority", parsePriority)
    .option("-p, --project <name>", "project name or id")
    .option("--milestone <name>", "project milestone")
    .option(CYCLE_FLAG, CYCLE_DESC)
    .option("--estimate <n>", "estimate points", parseIntOption)
    .option("--parent <id>", "parent issue id")
    .option("--due <date>", "due date (YYYY-MM-DD)")
    .option("-l, --label <name>", "replace all labels (repeatable / comma-separated)", parseList)
    .option("--add-label <name>", "add a label (repeatable)", parseList)
    .option("--remove-label <name>", "remove a label (repeatable)", parseList)
    .option("--unassign", "clear the assignee")
    .option("--clear-cycle", "remove the issue from its cycle")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear issue update TES-42 --state 'In Progress' --assignee me",
        "  linear issue update --priority 1 --add-label regression   # id from branch",
        "  linear issue update TES-42 --cycle current --json",
        "  linear issue update TES-42 --team ENG   # move to another team (new identifier)",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts, idArg?: string) => {
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: false,
        });
        const updated = await svc.updateIssue(ctx.client, requireId(idArg, ctx.defaultTeam), {
          title: opts.title,
          description,
          // Only the explicit flag moves an issue — never `ctx.defaultTeam`, or
          // every update in a repo with a configured team would be a team move.
          team: opts.team,
          assignee: opts.assignee,
          state: opts.state,
          priority: opts.priority,
          project: opts.project,
          milestone: opts.milestone,
          cycle: opts.cycle,
          estimate: opts.estimate,
          parent: opts.parent ? normalizeIssueReference(opts.parent, ctx.defaultTeam) : undefined,
          dueDate: readAlias(opts, "--due", "--due-date"),
          label: opts.label,
          addLabel: opts.addLabel,
          removeLabel: opts.removeLabel,
          unassign: opts.unassign,
          clearCycle: opts.clearCycle,
        });
        ctx.output.emit(
          { id: updated.id, identifier: updated.identifier, url: updated.url },
          () => {
            ctx.output.success(`Updated ${updated.identifier}`);
            // A move renumbers the issue and Linear drops what the destination
            // team cannot hold. Say so once, rather than letting a script's next
            // `TES-42` fail with "no such issue". Verified live — see CHANGELOG.
            if (opts.team) {
              ctx.output.info(
                `Moved to team ${updated.identifier.split("-")[0]}: the issue is now ${updated.identifier}. ` +
                  `Its cycle, team-scoped labels, and any project the new team is not part of do not carry over.`,
              );
            }
          },
        );
      }),
    );
  addAliasOption(update, "--due-date <date>", "--due");

  // assign / state ----------------------------------------------------------
  issue
    .command("assign [idOrAssignee] [assignee]")
    .description("Assign an issue (use 'me', email, name, or id). Issue defaults to the branch.")
    .action(
      action(async (ctx: Context, _opts, a?: string, b?: string) => {
        const { idArg, value } = oneOrTwo(a, b, "assignee");
        const updated = await svc.updateIssue(ctx.client, requireId(idArg, ctx.defaultTeam), {
          assignee: value,
        });
        ctx.output.emit({ id: updated.id, identifier: updated.identifier }, () =>
          ctx.output.success(`Assigned ${updated.identifier}`),
        );
      }),
    );

  issue
    .command("state [idOrState] [state]")
    .description("Move an issue to a workflow state. Issue defaults to the branch.")
    .action(
      action(async (ctx: Context, _opts, a?: string, b?: string) => {
        const { idArg, value } = oneOrTwo(a, b, "state");
        const updated = await svc.updateIssue(ctx.client, requireId(idArg, ctx.defaultTeam), {
          state: value,
        });
        ctx.output.emit({ id: updated.id, identifier: updated.identifier }, () =>
          ctx.output.success(`Moved ${updated.identifier} → ${value}`),
        );
      }),
    );

  // label -------------------------------------------------------------------
  issue
    .command("label [id]")
    .description("Add/remove labels on an issue")
    .option("--add <name>", "add a label (repeatable)", parseList)
    .option("--remove <name>", "remove a label (repeatable)", parseList)
    .action(
      action(async (ctx: Context, opts, idArg?: string) => {
        if (!opts.add && !opts.remove) throw usageError("Pass --add and/or --remove.");
        const updated = await svc.updateIssue(ctx.client, requireId(idArg, ctx.defaultTeam), {
          addLabel: opts.add,
          removeLabel: opts.remove,
        });
        ctx.output.emit({ id: updated.id, identifier: updated.identifier }, () =>
          ctx.output.success(`Updated labels on ${updated.identifier}`),
        );
      }),
    );

  // comment / comments ------------------------------------------------------
  const comment = issue
    .command("comment [id] [body]")
    .description(
      'Add a comment to an issue; on a matching branch, `issue comment "<body>"` is enough (or use the add/list/update/delete subcommands)',
    )
    .option("--body-file <path>", "read comment body from a file ('-' = stdin)")
    .option(
      "--mention <user>",
      "prepend a real Linear mention (name, email, me, or id; repeatable)",
      collectArray,
    )
    .action(
      action(async (ctx: Context, opts, a?: string, b?: string) => {
        // Both operands are optional, so a lone one is ambiguous: `TES-42` is
        // an id (body from --body-file or $EDITOR), anything else is the body
        // with the id inferred from the branch — the README's headline
        // `linear issue comment "shipped"`. Same rule as `assign`/`state`.
        const { idArg, bodyArg } = idAndBody(a, b);
        // Settle the id BEFORE the editor can open, so nobody writes a comment
        // only to be told there was nowhere to put it.
        const id = requireId(idArg, ctx.defaultTeam);
        const mentions: string[] = opts.mention ?? [];
        const body = resolveBody({
          arg: bodyArg,
          file: opts.bodyFile,
          interactive: ctx.isTTY && mentions.length === 0,
        });
        if (!body && mentions.length === 0) throw usageError("No comment body provided.");
        const { issue: iss, comment } = await commentSvc.addComment(ctx.client, id, body ?? "", {
          mentions,
        });
        ctx.output.emit({ id: comment?.id, issue: iss.identifier }, () =>
          ctx.output.success(`Commented on ${iss.identifier}`),
        );
      }),
    );
  // The reference CLI's `issue comment {add,list,update,delete}` layout, mounted
  // on the same handlers as the top-level `comment` group. Commander dispatches
  // to a subcommand only when the first operand matches one of these four names,
  // so `linear issue comment TES-1 'body'` is untouched.
  registerIssueCommentGroup(comment);

  issue
    .command("comments [id]")
    .description("List comments on an issue")
    .action(
      action(async (ctx: Context, _opts, idArg?: string) => {
        // Same implementation and row shape as `comment list` — TES-629: this
        // used to be a second, narrower lister with its own JSON.
        const comments = await commentSvc.listComments(
          ctx.client,
          requireId(idArg, ctx.defaultTeam),
          ctx.limit,
        );
        ctx.output.list(
          comments,
          [
            { key: "createdAt", header: "Date", value: (c) => c.createdAt.slice(0, 10) },
            { key: "user", header: "Author", value: (c) => c.user?.displayName ?? "—", max: 18 },
            { key: "body", header: "Comment", value: (c) => c.body.replace(/\n/g, " "), max: 70 },
          ],
          comments,
        );
      }),
    );

  // start -------------------------------------------------------------------
  // "Start" moves the issue: to the team's first `started` state, or to
  // `--state`. That is what the word means, what schpet/linear-cli does
  // unconditionally (T `src/utils/actions.ts`), and what an agent that just
  // said "start" expects to have happened. It used to be opt-in (`--move`), so
  // a transplanted `linear issue start TES-1` checked the branch out and left
  // the issue in Backlog without a word (TES-637 item 4). `--no-move` is the
  // opt-out; `--move` is still accepted (hidden) so an existing script keeps
  // working. Both the state change and the checkout are reported, so neither
  // is a surprise.
  issue
    .command("start [id]")
    .description(
      "Start work on an issue: check out its branch and move it to the first 'started' state",
    )
    .option("--state <name>", "move to this state instead of the first 'started' one")
    .option("--no-move", "do not change the state; only check out the branch")
    .addOption(new Option("--move", "accepted for compatibility: moving is the default").hideHelp())
    .option("--no-checkout", "do not touch git; only update state")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear issue start TES-42                     # branch + first 'started' state",
        "  linear issue start TES-42 --no-move           # branch only",
        "  linear issue start TES-42 --state 'In Review' --no-checkout",
        "  linear issue start --json | jq -r '.branch'   # id from branch",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts, idArg?: string) => {
        // `--state` is a move; `--no-move` says don't. Not a coin flip.
        if (opts.state !== undefined && opts.move === false) {
          throw usageError("Pass either --state or --no-move, not both.");
        }
        const moved = opts.state !== undefined || opts.move !== false;
        const issueModel = await resolveIssue(ctx.client, requireId(idArg, ctx.defaultTeam));
        let branchResult: { branch: string; created: boolean } | undefined;
        // Branch first, Linear second. A checkout failure is recoverable local
        // feedback and must never leave the remote issue claiming work started.
        if (opts.checkout !== false && isGitRepo()) {
          branchResult = checkoutBranch(issueModel.branchName);
        }
        await svc.moveIssueState(ctx.client, issueModel, {
          stateInput: opts.state,
          move: moved,
        });
        ctx.output.emit(
          {
            id: issueModel.id,
            identifier: issueModel.identifier,
            branch: branchResult?.branch ?? issueModel.branchName,
            checkedOut: !!branchResult,
            stateChanged: moved,
          },
          () => {
            if (branchResult)
              ctx.output.success(
                `${branchResult.created ? "Created and checked out" : "Checked out"} ${branchResult.branch}`,
              );
            if (moved)
              ctx.output.success(`Moved ${issueModel.identifier} → ${opts.state ?? "started"}`);
            if (!branchResult && !moved) ctx.output.info(`Branch name: ${issueModel.branchName}`);
          },
        );
      }),
    );

  // describe ----------------------------------------------------------------
  // The output is a whole commit message — `git commit -m "$(linear issue
  // describe)"` — in schpet/linear-cli's exact shape (`ID Title`, blank line,
  // `Linear-issue:` / `Linear-issue-url:` trailers; see `buildDescription` in
  // git.ts). It used to be `Title` + a bare `Fixes ID` line, so the same
  // pipeline produced a different commit (TES-637 item 5).
  issue
    .command("describe [id]")
    .description("Print a commit message for the issue: 'ID Title' plus Linear-issue trailers")
    .option("-r, --references", "link without closing: 'References <ID>' instead of 'Fixes <ID>'")
    .action(
      action(async (ctx: Context, opts, idArg?: string) => {
        const detail = await svc.getIssueDetail(ctx.client, requireId(idArg, ctx.defaultTeam), {
          includeComments: false,
        });
        const references = opts.references === true;
        const trailer = buildTrailer(detail.identifier, { references });
        const message = buildDescription(detail.identifier, detail.title, detail.url, {
          references,
        });
        ctx.output.emit(
          {
            identifier: detail.identifier,
            title: detail.title,
            url: detail.url,
            /** The magic-word phrase (`Fixes TES-1`); the trailers are `Linear-issue: <trailer>` + `Linear-issue-url: <url>`. */
            trailer,
            /** The full message, exactly as the human output prints it. */
            message,
          },
          () => ctx.output.line(message),
        );
      }),
    );

  // pull-request ------------------------------------------------------------
  issue
    .command("pull-request [id]")
    .alias("pr")
    .description("Create a GitHub PR for the issue via the gh CLI")
    .option("--base <branch>", "base branch for the PR")
    .option("--head <branch>", "head branch for the PR")
    .option("--draft", "create the PR as a draft")
    .option("--title <title>", "PR title after the issue id (default: the issue title)")
    .option("-w, --web", "open the PR creation page in the browser")
    .action(
      action(async (ctx: Context, opts, idArg?: string) => {
        if (!isGitRepo()) {
          throw usageError("`issue pr` must be run inside a git repository.");
        }
        const detail = await svc.getIssueDetail(ctx.client, requireId(idArg, ctx.defaultTeam), {
          includeComments: false,
        });
        // Title `ID Title` (a custom --title is prefixed the same way), body the
        // two Linear-issue trailers — schpet/linear-cli's PR, plus the magic word
        // (`buildPrContent`). The issue's *description* is no longer copied in
        // (TES-637 item 5): a GitHub PR body is a wider audience than a Linear
        // issue, and Linear links the PR from the trailer, not from the prose.
        const { title, body } = buildPrContent(detail, opts.title);
        const args = buildPrArgs({
          title,
          body,
          base: opts.base,
          head: opts.head,
          draft: opts.draft,
          web: opts.web,
        });

        if (opts.web) {
          runGh(args);
          ctx.output.emit({ web: true, identifier: detail.identifier }, () =>
            ctx.output.info(`Opening a PR for ${detail.identifier} in the browser…`),
          );
          return;
        }

        const url = runGh(args).trim();
        ctx.output.emit({ url, identifier: detail.identifier, title }, () =>
          ctx.output.success(`Created PR for ${detail.identifier}: ${url}`),
        );
      }),
    );

  // relation ----------------------------------------------------------------
  issue
    .command("relation <id> <op> [other]")
    .description("Manage issue relations: op = add|remove|list")
    .option("--blocks", "relation type: blocks")
    .option("--blocked-by", "relation type: blocked by")
    .option("--related", "relation type: related (default)")
    .option("--duplicate", "relation type: duplicate")
    .action(
      action(async (ctx: Context, opts, id: string, op: string, other?: string) => {
        const issueId = normalizeIssueReference(id, ctx.defaultTeam);
        if (op === "list") {
          const rels = await svc.listRelations(ctx.client, issueId);
          ctx.output.list(
            rels,
            [
              { key: "type", header: "Type", value: (r) => r.type },
              { key: "issue", header: "Issue", value: (r) => r.issue },
              { key: "title", header: "Title", value: (r) => r.title, max: 60 },
            ],
            rels,
          );
          return;
        }
        if (op !== "add" && op !== "remove") throw usageError("op must be add, remove, or list.");
        if (!other) throw usageError("Specify the other issue id.");
        const type = opts.blocks
          ? "blocks"
          : opts.blockedBy
            ? "blocked_by"
            : opts.duplicate
              ? "duplicate"
              : "related";
        const { issue: a, other: b } = await svc.addRemoveRelation(
          ctx.client,
          issueId,
          op,
          type as any,
          normalizeIssueReference(other, ctx.defaultTeam),
        );
        ctx.output.emit(
          {
            issueId: a.id,
            issueIdentifier: a.identifier,
            otherId: b.id,
            otherIdentifier: b.identifier,
            type,
            op,
          },
          () =>
            ctx.output.success(
              `${op === "add" ? "Added" : "Removed"} ${type} relation ${a.identifier} ↔ ${b.identifier}`,
            ),
        );
      }),
    );

  // subscribe / unsubscribe -------------------------------------------------
  issue
    .command("subscribe [id]")
    .description("Subscribe to an issue")
    .action(
      action(async (ctx: Context, _opts, idArg?: string) => {
        const iss = await svc.setSubscription(ctx.client, requireId(idArg, ctx.defaultTeam), true);
        ctx.output.emit({ id: iss.id, identifier: iss.identifier, subscribed: true }, () =>
          ctx.output.success(`Subscribed to ${iss.identifier}`),
        );
      }),
    );
  issue
    .command("unsubscribe [id]")
    .description("Unsubscribe from an issue")
    .action(
      action(async (ctx: Context, _opts, idArg?: string) => {
        const iss = await svc.setSubscription(ctx.client, requireId(idArg, ctx.defaultTeam), false);
        ctx.output.emit({ id: iss.id, identifier: iss.identifier, subscribed: false }, () =>
          ctx.output.success(`Unsubscribed from ${iss.identifier}`),
        );
      }),
    );

  // archive / unarchive / delete -------------------------------------------
  issue
    .command("archive [id]")
    .description("Archive an issue")
    .option("--bulk <ids>", "archive comma-separated issue ids (repeatable)", parseList)
    .option("--bulk-file <path>", "archive issue ids from a file (one per line)")
    .option("--bulk-stdin", "archive issue ids read from stdin (one per line)")
    .action(
      action(async (ctx: Context, opts, idArg?: string) => {
        await runBulkIssueMutation(ctx, opts, idArg, "archive", (id) =>
          svc.archiveIssue(ctx.client, id, false),
        );
      }),
    );
  issue
    .command("unarchive [id]")
    .description("Unarchive an issue")
    .action(
      action(async (ctx: Context, _opts, idArg?: string) => {
        const iss = await svc.archiveIssue(ctx.client, requireId(idArg, ctx.defaultTeam), true);
        ctx.output.emit({ id: iss.id, identifier: iss.identifier, archived: false }, () =>
          ctx.output.success(`Unarchived ${iss.identifier}`),
        );
      }),
    );
  issue
    .command("delete [id]")
    .alias("rm")
    .description("Delete (trash) an issue")
    .option("--bulk <ids>", "delete comma-separated issue ids (repeatable)", parseList)
    .option("--bulk-file <path>", "delete issue ids from a file (one per line)")
    .option("--bulk-stdin", "delete issue ids read from stdin (one per line)")
    .action(
      action(async (ctx: Context, opts, idArg?: string) => {
        await runBulkIssueMutation(ctx, opts, idArg, "delete", (id) =>
          svc.deleteIssue(ctx.client, id),
        );
      }),
    );

  // scalar getters: id / title / url / branch ------------------------------
  registerScalar(issue, "id", "Print the current issue's identifier", (d) => d.identifier);
  registerScalar(issue, "title", "Print the issue title", (d) => d.title);
  registerScalar(issue, "url", "Print the issue URL", (d) => d.url);
  registerScalar(issue, "branch", "Print the suggested git branch name", (d) => d.branchName);
}

type BulkAction = "archive" | "delete";
type BulkIssueResult = {
  input: string;
  id?: string;
  identifier?: string;
  archived?: boolean;
  deleted?: boolean;
  error?: { message: string; code: string };
};

/**
 * Collect issue ids from one explicit source. A positional id remains the
 * ergonomic path for one issue (and can still be inferred from the branch),
 * while bulk sources intentionally never consult the branch: an empty input
 * must not accidentally mutate the current issue.
 */
function bulkIssueIds(
  opts: Record<string, unknown>,
  idArg: string | undefined,
): string[] | undefined {
  const sources = [
    Array.isArray(opts.bulk) && opts.bulk.length > 0 ? "--bulk" : undefined,
    typeof opts.bulkFile === "string" ? "--bulk-file" : undefined,
    opts.bulkStdin === true ? "--bulk-stdin" : undefined,
  ].filter((v): v is string => !!v);
  if (sources.length === 0) return undefined;
  if (sources.length > 1 || idArg !== undefined) {
    throw usageError(
      "Pass either one issue id or exactly one of --bulk, --bulk-file, and --bulk-stdin.",
    );
  }
  let values: string[];
  if (sources[0] === "--bulk") values = opts.bulk as string[];
  else {
    const path = sources[0] === "--bulk-stdin" ? 0 : (opts.bulkFile as string);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (err) {
      throw new CliError(
        `Cannot read ${sources[0] === "--bulk-stdin" ? "stdin" : path}: ${(err as Error).message}`,
        "runtime",
      );
    }
    values = text.split(/[\s,]+/).filter(Boolean);
  }
  const ids = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (ids.length === 0) throw usageError(`${sources[0]} did not contain any issue ids.`);
  return ids;
}

async function runBulkIssueMutation(
  ctx: Context,
  opts: Record<string, unknown>,
  idArg: string | undefined,
  actionName: BulkAction,
  mutate: (id: string) => Promise<{ id: string; identifier: string }>,
): Promise<void> {
  const bulk = bulkIssueIds(opts, idArg);
  const ids = bulk ?? [requireId(idArg, ctx.defaultTeam)];
  const single = bulk === undefined;
  const noun = actionName === "archive" ? "Archive" : "Delete";
  const message = single ? `${noun} issue ${ids[0]}?` : `${noun} ${ids.length} issues?`;
  if (!(await confirmDestructive(ctx, message))) return;

  const results: BulkIssueResult[] = [];
  for (const input of ids) {
    const id = normalizeIssueReference(input, ctx.defaultTeam);
    try {
      const issue = await mutate(id);
      results.push({
        input,
        id: issue.id,
        identifier: issue.identifier,
        [actionName === "archive" ? "archived" : "deleted"]: true,
      });
    } catch (err) {
      const normalized = normalizeError(err);
      results.push({ input, error: { message: normalized.message, code: normalized.code } });
    }
  }

  if (single) {
    const result = results[0]!;
    if (result.error)
      throw new CliError(result.error.message, result.error.code as CliError["code"]);
    ctx.output.emit(
      actionName === "archive"
        ? { id: result.id!, identifier: result.identifier!, archived: true }
        : { id: result.id!, identifier: result.identifier!, deleted: true },
      () => ctx.output.success(`${noun}d ${result.identifier}`),
    );
    return;
  }

  const failures = results.filter((result) => result.error).length;
  ctx.output.emit(
    { action: actionName, results, succeeded: results.length - failures, failed: failures },
    () => {
      for (const result of results) {
        if (result.error) ctx.output.warn(`${result.input}: ${result.error.message}`);
        else ctx.output.success(`${noun}d ${result.identifier}`);
      }
      ctx.output.info(`${results.length - failures}/${results.length} issues ${actionName}d.`);
    },
  );
  if (failures > 0) process.exitCode = 1;
}

/**
 * Render a single issue's detail block. Shared by `issue view` and the bare
 * `linear` command so `linear --json` === `issue view <id> --json`.
 */
export async function renderIssueDetail(
  ctx: Context,
  detail: svc.IssueDetail,
  includeComments: boolean,
  showResolvedThreads = false,
): Promise<void> {
  const { cycle, team } = detail;
  const commentPairs = includeComments
    ? issueCommentPairs(detail.comments, showResolvedThreads)
    : [];
  ctx.output.detail(detail, [
    ["Issue", `${detail.identifier}  ${detail.title}`],
    // A deleted issue used to view exactly like a live one. Say so first, and
    // in capitals: an agent that deletes and re-reads must see the change.
    [
      "Trashed",
      detail.trashed ? `YES (deleted ${detail.archivedAt ?? "at an unknown time"})` : null,
    ],
    ["Archived", !detail.trashed && detail.archivedAt ? `YES (${detail.archivedAt})` : null],
    ["State", detail.state?.name ?? null],
    ["Priority", detail.priorityLabel],
    ["Assignee", detail.assignee?.displayName ?? null],
    ["Team", team ? `${team.key} ${team.name}` : null],
    ["Project", detail.project?.name ?? null],
    ["Milestone", detail.milestone?.name ?? null],
    ["Cycle", cycle ? `#${cycle.number}${cycle.name ? ` ${cycle.name}` : ""}` : null],
    ["Parent", detail.parent ? issueRefLabel(detail.parent) : null],
    [
      "Sub-issues",
      detail.children.length ? `\n${detail.children.map(issueRefLabel).join("\n")}` : null,
    ],
    ["Estimate", detail.estimate],
    ["Labels", detail.labels.length ? detail.labels.map((l) => l.name).join(", ") : null],
    [
      "Attachments",
      detail.attachments.length ? `\n${detail.attachments.map(attachmentLabel).join("\n")}` : null,
    ],
    [
      "Documents",
      detail.documents.length
        ? `\n${detail.documents.map((d) => `${d.title}: ${d.url}`).join("\n")}`
        : null,
    ],
    ["Relations", relationLabels(detail)],
    ["Due", detail.dueDate],
    ["URL", detail.url],
    ["Updated", detail.updatedAt],
    ["Description", detail.description ? `\n${detail.description}` : null],
    ...commentPairs,
  ]);
}

function issueRefLabel(issue: svc.IssueDetailRef): string {
  return `${issue.identifier}  ${issue.title}${issue.state ? ` [${issue.state.name}]` : ""}`;
}

function attachmentLabel(attachment: svc.IssueAttachmentDetail): string {
  const source = attachment.sourceType ? ` [${attachment.sourceType}]` : "";
  const subtitle = attachment.subtitle ? ` — ${attachment.subtitle}` : "";
  return `${attachment.title}: ${attachment.url}${source}${subtitle}`;
}

function relationLabels(detail: svc.IssueDetail): string | null {
  const lines = [
    ...detail.relations.map(
      (r) => `${relationVerb(r.type, false)} ${issueRefLabel(r.relatedIssue)}`,
    ),
    ...detail.inverseRelations.map(
      (r) => `${relationVerb(r.type, true)} ${issueRefLabel(r.issue)}`,
    ),
  ];
  return lines.length ? `\n${lines.join("\n")}` : null;
}

function relationVerb(type: string, inverse: boolean): string {
  if (type === "blocks") return inverse ? "Blocked by" : "Blocks";
  if (type === "duplicate") return inverse ? "Duplicated by" : "Duplicates";
  return type === "related" ? "Related to" : `${inverse ? "Inverse" : "Related"} (${type})`;
}

/** Human comment rows grouped as threads, hiding resolved roots unless requested. */
function issueCommentPairs(
  comments: svc.IssueCommentDetail[],
  showResolvedThreads: boolean,
): Array<[string, unknown]> {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const rootId = (comment: svc.IssueCommentDetail): string => {
    const seen = new Set<string>();
    let current = comment;
    while (current.parent && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = byId.get(current.parent.id);
      if (!parent) break;
      current = parent;
    }
    return current.id;
  };
  const roots = comments.filter((comment) => !comment.parent);
  const visibleRoots = roots.filter((comment) => showResolvedThreads || !comment.resolvedAt);
  const visibleIds = new Set(visibleRoots.map((comment) => comment.id));
  const pairs: Array<[string, unknown]> = [];

  for (const root of visibleRoots) {
    pairs.push(["Comment", commentLabel(root, false)]);
    for (const reply of comments) {
      if (reply.parent && rootId(reply) === root.id && visibleIds.has(root.id)) {
        pairs.push(["Reply", commentLabel(reply, true)]);
      }
    }
  }
  const hidden = roots.length - visibleRoots.length;
  if (hidden > 0) {
    pairs.push([
      "Comments",
      `${hidden} resolved ${hidden === 1 ? "thread" : "threads"} hidden; use --show-resolved-threads to show ${hidden === 1 ? "it" : "them"}.`,
    ]);
  }
  return pairs;
}

function commentLabel(comment: svc.IssueCommentDetail, reply: boolean): string {
  const author = comment.user?.displayName ?? comment.externalUser?.displayName ?? "Unknown";
  const thread = reply ? "" : ` [thread: ${comment.id}]`;
  const resolved = comment.resolvedAt
    ? ` [resolved${comment.resolvingUser ? ` by ${comment.resolvingUser.displayName}` : ""}]`
    : "";
  return `@${author} ${comment.createdAt.slice(0, 10)}${thread}${resolved}\n${comment.body}`;
}

function registerScalar(
  issue: Command,
  name: string,
  description: string,
  pick: (d: svc.IssueDetail) => string,
): void {
  issue
    .command(`${name} [id]`)
    .description(description)
    .action(
      action(async (ctx: Context, _opts, idArg?: string) => {
        const detail = await svc.getIssueDetail(ctx.client, requireId(idArg, ctx.defaultTeam), {
          includeComments: false,
        });
        ctx.output.emit({ [name]: pick(detail) }, () => ctx.output.line(pick(detail)));
      }),
    );
}

const ISSUE_ID_RE =
  /^(\d+|[a-zA-Z][a-zA-Z0-9]*-\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Disambiguate `[id] [value]` where both are optional so the issue id can be
 * inferred from the branch. Two args → (id, value). One arg → it's the value
 * unless it looks like an issue id (then the value is missing → usage error).
 */
function oneOrTwo(
  a: string | undefined,
  b: string | undefined,
  valueName: string,
): {
  idArg?: string;
  value: string;
} {
  if (a !== undefined && b !== undefined) return { idArg: a, value: b };
  if (a === undefined) throw usageError(`Missing ${valueName}.`);
  if (ISSUE_ID_RE.test(a)) {
    throw usageError(
      `Missing ${valueName}. Usage: <id> <${valueName}>  (or just <${valueName}> on a matching branch)`,
    );
  }
  return { value: a };
}

/**
 * `oneOrTwo`'s sibling for `issue comment [id] [body]`, where the value may
 * legitimately be absent (it can come from --body-file or $EDITOR): a lone
 * operand that looks like an issue id IS the id; anything else is the body.
 */
function idAndBody(
  a: string | undefined,
  b: string | undefined,
): { idArg?: string; bodyArg?: string } {
  if (a !== undefined && b !== undefined) return { idArg: a, bodyArg: b };
  if (a === undefined) return {};
  return ISSUE_ID_RE.test(a) ? { idArg: a } : { bodyArg: a };
}

/**
 * Invoke `gh` with the given argv, returning its stdout. `gh`'s stderr is
 * captured (so it never pollutes our stdout / the `--json` contract) and only
 * surfaced when gh fails — as the message of a clear CliError. Failures map to
 * helpful errors: a missing `gh` becomes a usage error.
 */
function runGh(args: string[]): string {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number; stderr?: Buffer | string };
    if (e.code === "ENOENT") {
      throw usageError(
        "GitHub CLI (gh) is required for `issue pr`. Install it from https://cli.github.com.",
      );
    }
    const stderr = e.stderr ? e.stderr.toString().trim() : "";
    throw new CliError(stderr || `gh exited with code ${e.status ?? 1}.`, "runtime");
  }
}
