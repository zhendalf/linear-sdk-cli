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
  CYCLE_FLAG,
  CYCLE_DESC,
  suggestSubcommand,
} from "../lib/options.js";
import { registerIssueCommentGroup } from "./comment.js";
import { resolveBody } from "../lib/body.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import { usageError } from "../lib/errors.js";
import {
  currentIssueId,
  checkoutBranch,
  isGitRepo,
  buildTrailer,
  buildPrArgs,
} from "../git.js";
import { execFileSync } from "node:child_process";
import { CliError } from "../lib/errors.js";
import type { Context } from "../context.js";
import * as svc from "../services/issue.js";
import * as commentSvc from "../services/comment.js";
import { isSelf } from "../lib/resolve.js";
import type { Column } from "../output/table.js";

/** Resolve the target issue id from an argument or the current git branch. */
function requireId(idArg: string | undefined): string {
  const id = idArg ?? currentIssueId();
  if (!id) {
    throw usageError("No issue id given and none could be inferred from the current branch.");
  }
  return id;
}

const ROW_COLUMNS: Column<svc.IssueRow>[] = [
  { key: "id", header: "ID", value: (r) => r.identifier },
  // `--include-archived` mixes live, archived and trashed rows; mark the latter
  // two so they cannot pass for live. The state name alone stays under 14.
  { key: "state", header: "State", value: (r) => `${r.state?.name ?? ""}${lifecycleMark(r)}`, max: 26 },
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

/**
 * schpet/linear-cli `issue` subcommands that a migrating user may type and that
 * do not exist under that name here. Since `view` is the default subcommand,
 * `linear issue attach x` lands in `view` with "attach" as the id; without this
 * the error would only say it is not an issue id. Keep in step with MIGRATING.md.
 */
const SCHPET_ISSUE_SUBCOMMANDS: Record<string, string> = {
  attach: "File upload is not available yet (tracked). To attach a URL: 'linear attachment create <issue> --url <url>'.",
  link: "Use 'linear attachment create <issue> --url <url>'.",
  commits: "'issue commits' is not available here (jj/git log integration is not adopted). Use 'git log --grep <ID>'.",
  "agent-session": "Use 'linear issue agent-session list|view <issue>'.",
};

export function registerIssue(program: Command): void {
  const issue = program.command("issue").alias("i").description("Work with issues");

  // view --------------------------------------------------------------------
  issue
    .command("view [id]", { isDefault: true })
    .description("Show an issue (defaults to the current branch's issue)")
    .option("-w, --web", "open the issue in the browser instead of printing")
    .option("--comments", "include recent comments")
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
            `'${idArg}' is not a valid issue id (expected e.g. TES-123 or a UUID).${
              ported ? ` ${ported}` : guess ? ` Did you mean 'linear issue ${guess}'?` : ""
            }`,
          );
        }
        const detail = await svc.getIssueDetail(ctx.client, requireId(idArg));
        if (opts.web) {
          await openUrl(detail.url);
          ctx.output.emit(
            { id: detail.id, identifier: detail.identifier, url: detail.url, opened: true },
            () => ctx.output.success(`Opened ${detail.identifier}`),
          );
          return;
        }
        await renderIssueDetail(ctx, detail, !!opts.comments);
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
    new Option("--all-states", "accepted for compatibility (list is all-states already)").hideHelp(),
  );

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
    .option("-P, --priority <0-4>", "priority", parseIntOption)
    .option("-l, --label <name>", "label (repeatable / comma-separated)", parseList)
    .option("-p, --project <name>", "project name or id")
    .option("--milestone <name>", "project milestone (requires --project)")
    .option(CYCLE_FLAG, CYCLE_DESC)
    .option("--estimate <n>", "estimate points", parseIntOption)
    .option("--parent <id>", "parent issue id (the sub-issue joins the parent's project unless --project says otherwise)")
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
            parent: opts.parent,
            dueDate: readAlias(opts, "--due", "--due-date"),
            template: opts.template,
            // Both spellings: ours, and the reference CLI's `--no-use-default-template`.
            useDefaultTemplate: opts.defaultTemplate !== false && opts.useDefaultTemplate !== false,
          },
          ctx.defaultTeam,
        );
        if (!opts.start) {
          ctx.output.emit({ id: created.id, identifier: created.identifier, url: created.url }, () =>
            ctx.output.success(`Created ${created.identifier}: ${created.url}`),
          );
          return;
        }
        // --start: the same two steps `issue start --move` takes, on the issue
        // just created. An explicit --state already put it where it belongs, so
        // only the default case moves it (to the team's first `started` state).
        const moved = !opts.state;
        await svc.moveIssueState(ctx.client, created, { move: moved });
        const branchResult = isGitRepo() ? checkoutBranch(created.branchName) : undefined;
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
    .option("-P, --priority <0-4>", "priority", parseIntOption)
    .option("-p, --project <name>", "project name or id")
    .option("--milestone <name>", "project milestone")
    .option(CYCLE_FLAG, CYCLE_DESC)
    .option("--estimate <n>", "estimate points", parseIntOption)
    .option("--parent <id>", "parent issue id")
    .option("--due <date>", "due date (YYYY-MM-DD)")
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
        const updated = await svc.updateIssue(ctx.client, requireId(idArg), {
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
          parent: opts.parent,
          dueDate: readAlias(opts, "--due", "--due-date"),
          addLabel: opts.addLabel,
          removeLabel: opts.removeLabel,
          unassign: opts.unassign,
          clearCycle: opts.clearCycle,
        });
        ctx.output.emit({ id: updated.id, identifier: updated.identifier, url: updated.url }, () => {
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
        });
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
        const updated = await svc.updateIssue(ctx.client, requireId(idArg), { assignee: value });
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
        const updated = await svc.updateIssue(ctx.client, requireId(idArg), { state: value });
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
        const updated = await svc.updateIssue(ctx.client, requireId(idArg), {
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
      "Add a comment to an issue; on a matching branch, `issue comment \"<body>\"` is enough (or use the add/list/update/delete subcommands)",
    )
    .option("--body-file <path>", "read comment body from a file ('-' = stdin)")
    .action(
      action(async (ctx: Context, opts, a?: string, b?: string) => {
        // Both operands are optional, so a lone one is ambiguous: `TES-42` is
        // an id (body from --body-file or $EDITOR), anything else is the body
        // with the id inferred from the branch — the README's headline
        // `linear issue comment "shipped"`. Same rule as `assign`/`state`.
        const { idArg, bodyArg } = idAndBody(a, b);
        // Settle the id BEFORE the editor can open, so nobody writes a comment
        // only to be told there was nowhere to put it.
        const id = requireId(idArg);
        const body = resolveBody({ arg: bodyArg, file: opts.bodyFile, interactive: ctx.isTTY });
        if (!body) throw usageError("No comment body provided.");
        const { issue: iss, comment } = await commentSvc.addComment(ctx.client, id, body);
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
        const comments = await commentSvc.listComments(ctx.client, requireId(idArg), ctx.limit);
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
  issue
    .command("start [id]")
    .description("Checkout the issue's git branch (and optionally move its state)")
    .option("--state <name>", "also move the issue to this state")
    .option("--move", "move the issue to the first 'started' state")
    .option("--no-checkout", "do not touch git; only update state")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear issue start TES-42            # checkout the issue's branch",
        "  linear issue start TES-42 --move     # branch + move to first 'started' state",
        "  linear issue start TES-42 --state 'In Progress' --no-checkout",
        "  linear issue start --json | jq -r '.branch'   # id from branch",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts, idArg?: string) => {
        const moved = !!opts.state || !!opts.move;
        const issueModel = await svc.startIssue(ctx.client, requireId(idArg), {
          stateInput: opts.state,
          move: opts.move,
        });
        let branchResult: { branch: string; created: boolean } | undefined;
        if (opts.checkout !== false && isGitRepo()) {
          branchResult = checkoutBranch(issueModel.branchName);
        }
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
            if (moved) ctx.output.success(`Moved ${issueModel.identifier} → ${opts.state ?? "started"}`);
            if (!branchResult && !moved) ctx.output.info(`Branch name: ${issueModel.branchName}`);
          },
        );
      }),
    );

  // describe ----------------------------------------------------------------
  issue
    .command("describe [id]")
    .description("Print the issue title and a commit-message trailer (Fixes <ID>)")
    .option("-r, --references", "use a 'References <ID>' trailer instead of 'Fixes <ID>'")
    .action(
      action(async (ctx: Context, opts, idArg?: string) => {
        const detail = await svc.getIssueDetail(ctx.client, requireId(idArg));
        const trailer = buildTrailer(detail.identifier, { references: opts.references });
        ctx.output.emit({ identifier: detail.identifier, title: detail.title, trailer }, () => {
          ctx.output.line(detail.title);
          ctx.output.line();
          ctx.output.line(trailer);
        });
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
    .option("--title <title>", "PR title (defaults to the issue title)")
    .option("-w, --web", "open the PR creation page in the browser")
    .action(
      action(async (ctx: Context, opts, idArg?: string) => {
        if (!isGitRepo()) {
          throw usageError("`issue pr` must be run inside a git repository.");
        }
        const detail = await svc.getIssueDetail(ctx.client, requireId(idArg));
        const title = opts.title ?? detail.title;
        // Body = issue description (may be empty), then a trailer linking Linear
        // both ways: the magic word closes the issue on merge, the URL backlinks.
        const description = detail.description?.trim();
        const trailerBlock = `${buildTrailer(detail.identifier)}\n${detail.url}`;
        const body = description ? `${description}\n\n${trailerBlock}` : trailerBlock;
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
        if (op === "list") {
          const rels = await svc.listRelations(ctx.client, id);
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
        const { issue: a, other: b } = await svc.addRemoveRelation(ctx.client, id, op, type as any, other);
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
        const iss = await svc.setSubscription(ctx.client, requireId(idArg), true);
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
        const iss = await svc.setSubscription(ctx.client, requireId(idArg), false);
        ctx.output.emit({ id: iss.id, identifier: iss.identifier, subscribed: false }, () =>
          ctx.output.success(`Unsubscribed from ${iss.identifier}`),
        );
      }),
    );

  // archive / unarchive / delete -------------------------------------------
  issue
    .command("archive [id]")
    .description("Archive an issue")
    .action(
      action(async (ctx: Context, _opts, idArg?: string) => {
        const id = requireId(idArg);
        if (!(await confirmDestructive(ctx, `Archive issue ${id}?`))) return;
        const iss = await svc.archiveIssue(ctx.client, id, false);
        ctx.output.emit({ id: iss.id, identifier: iss.identifier, archived: true }, () =>
          ctx.output.success(`Archived ${iss.identifier}`),
        );
      }),
    );
  issue
    .command("unarchive [id]")
    .description("Unarchive an issue")
    .action(
      action(async (ctx: Context, _opts, idArg?: string) => {
        const iss = await svc.archiveIssue(ctx.client, requireId(idArg), true);
        ctx.output.emit({ id: iss.id, identifier: iss.identifier, archived: false }, () =>
          ctx.output.success(`Unarchived ${iss.identifier}`),
        );
      }),
    );
  issue
    .command("delete [id]")
    .alias("rm")
    .description("Delete (trash) an issue")
    .action(
      action(async (ctx: Context, _opts, idArg?: string) => {
        const id = requireId(idArg);
        if (!(await confirmDestructive(ctx, `Delete issue ${id}?`))) return;
        const iss = await svc.deleteIssue(ctx.client, id);
        ctx.output.emit({ id: iss.id, identifier: iss.identifier, deleted: true }, () =>
          ctx.output.success(`Deleted ${iss.identifier}`),
        );
      }),
    );

  // scalar getters: id / title / url / branch ------------------------------
  registerScalar(issue, "id", "Print the current issue's identifier", (d) => d.identifier);
  registerScalar(issue, "title", "Print the issue title", (d) => d.title);
  registerScalar(issue, "url", "Print the issue URL", (d) => d.url);
  registerScalar(issue, "branch", "Print the suggested git branch name", (d) => d.branchName);
}

/**
 * Render a single issue's detail block. Shared by `issue view` and the bare
 * `linear` command so `linear --json` === `issue view <id> --json`.
 */
export async function renderIssueDetail(
  ctx: Context,
  detail: svc.IssueDetail,
  includeComments: boolean,
): Promise<void> {
  const comments = includeComments ? await commentSvc.listComments(ctx.client, detail.id, 10) : [];
  const { cycle, team } = detail;
  ctx.output.detail({ ...detail, comments: includeComments ? comments : undefined }, [
    ["Issue", `${detail.identifier}  ${detail.title}`],
    // A deleted issue used to view exactly like a live one. Say so first, and
    // in capitals: an agent that deletes and re-reads must see the change.
    ["Trashed", detail.trashed ? `YES (deleted ${detail.archivedAt ?? "at an unknown time"})` : null],
    ["Archived", !detail.trashed && detail.archivedAt ? `YES (${detail.archivedAt})` : null],
    ["State", detail.state?.name ?? null],
    ["Priority", detail.priorityLabel],
    ["Assignee", detail.assignee?.displayName ?? null],
    ["Team", team ? `${team.key} ${team.name}` : null],
    ["Project", detail.project?.name ?? null],
    ["Milestone", detail.milestone?.name ?? null],
    ["Cycle", cycle ? `#${cycle.number}${cycle.name ? ` ${cycle.name}` : ""}` : null],
    ["Parent", detail.parent?.identifier ?? null],
    ["Estimate", detail.estimate],
    ["Labels", detail.labels.length ? detail.labels.map((l) => l.name).join(", ") : null],
    ["Due", detail.dueDate],
    ["URL", detail.url],
    ["Updated", detail.updatedAt],
    ["Description", detail.description ? `\n${detail.description}` : null],
    ...(includeComments
      ? comments.map(
          (c) => [c.createdAt.slice(0, 10) + " " + (c.user?.displayName ?? "—"), c.body] as [string, unknown],
        )
      : []),
  ]);
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
        const detail = await svc.getIssueDetail(ctx.client, requireId(idArg));
        ctx.output.emit({ [name]: pick(detail) }, () => ctx.output.line(pick(detail)));
      }),
    );
}

const ISSUE_ID_RE = /^([a-zA-Z][a-zA-Z0-9]*-\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Disambiguate `[id] [value]` where both are optional so the issue id can be
 * inferred from the branch. Two args → (id, value). One arg → it's the value
 * unless it looks like an issue id (then the value is missing → usage error).
 */
function oneOrTwo(a: string | undefined, b: string | undefined, valueName: string): {
  idArg?: string;
  value: string;
} {
  if (a !== undefined && b !== undefined) return { idArg: a, value: b };
  if (a === undefined) throw usageError(`Missing ${valueName}.`);
  if (ISSUE_ID_RE.test(a)) {
    throw usageError(`Missing ${valueName}. Usage: <id> <${valueName}>  (or just <${valueName}> on a matching branch)`);
  }
  return { value: a };
}

/**
 * `oneOrTwo`'s sibling for `issue comment [id] [body]`, where the value may
 * legitimately be absent (it can come from --body-file or $EDITOR): a lone
 * operand that looks like an issue id IS the id; anything else is the body.
 */
function idAndBody(a: string | undefined, b: string | undefined): { idArg?: string; bodyArg?: string } {
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

async function openUrl(url: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  await new Promise<void>((resolve) => execFile(cmd, [url], () => resolve()));
}
