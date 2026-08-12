/**
 * `linear issue` (alias `i`) — the core, git-branch-aware command group.
 *
 * When an issue id is omitted, it is inferred from the current git branch
 * (`tes-123-foo` → `TES-123`).
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import {
  addFilterOptions,
  addCoreFilterOptions,
  parseList,
  parseIntOption,
  CYCLE_FLAG,
  CYCLE_DESC,
} from "../lib/options.js";
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
  { key: "state", header: "State", value: (r) => r.state?.name ?? "", max: 14 },
  { key: "priority", header: "Pri", value: (r) => shortPriority(r.priority) },
  { key: "assignee", header: "Assignee", value: (r) => r.assignee?.displayName ?? "—", max: 16 },
  { key: "title", header: "Title", value: (r) => r.title, max: 60 },
];

function shortPriority(p: number): string {
  return ["—", "Urgent", "High", "Med", "Low"][p] ?? String(p);
}

export function registerIssue(program: Command): void {
  const issue = program.command("issue").alias("i").description("Work with issues");

  // view --------------------------------------------------------------------
  issue
    .command("view [id]", { isDefault: true })
    .description("Show an issue (defaults to the current branch's issue)")
    .option("--web", "open the issue in the browser instead of printing")
    .option("--comments", "include recent comments")
    .action(
      action(async (ctx: Context, opts, idArg?: string) => {
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
    .description("List issues with filters")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear issue list --assignee me --state 'In Progress'",
        "  linear issue list --team TES --label bug --sort priority",
        "  linear issue list --cycle current --json | jq -r '.[].identifier'",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts) => {
        const rows = await svc.listIssues(
          ctx.client,
          {
            team: opts.team ?? ctx.defaultTeam,
            allTeams: opts.allTeams,
            assignee: opts.assignee,
            state: opts.state,
            project: opts.project,
            label: opts.label,
            priority: opts.priority,
            cycle: opts.cycle,
            query: opts.query,
            sort: svc.resolveIssueSort(opts.sort, ctx.config),
            includeArchived: opts.includeArchived,
          },
          ctx.limit,
          ctx.defaultTeam,
        );
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );
  addFilterOptions(list);

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
            state: opts.state,
            project: opts.project,
            label: opts.label,
            priority: opts.priority,
            cycle: opts.cycle,
            includeArchived: opts.includeArchived,
          },
          ctx.limit,
          ctx.defaultTeam,
        );
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );
  addCoreFilterOptions(search);

  // create ------------------------------------------------------------------
  issue
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
    .option("--parent <id>", "parent issue id")
    .option("--due <date>", "due date (YYYY-MM-DD)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear issue create --title 'Fix login' --team TES --assignee me",
        "  linear issue create --title 'Bug' -l bug -l urgent --priority 1",
        "  linear issue create --title 'Sprint task' --cycle current --state 'In Progress'",
        "  linear issue create --title 'API' --team TES --json | jq -r '.identifier'",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts) => {
        let title: string | undefined = opts.title;
        if (!title) title = await promptInput(ctx, "Title:", { required: true });
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: !!opts.editor && ctx.isTTY,
        });
        const created = await svc.createIssue(
          ctx.client,
          {
            title,
            description,
            team: opts.team ?? ctx.defaultTeam,
            assignee: opts.assignee,
            state: opts.state,
            priority: opts.priority,
            label: opts.label,
            project: opts.project,
            milestone: opts.milestone,
            cycle: opts.cycle,
            estimate: opts.estimate,
            parent: opts.parent,
            dueDate: opts.due,
          },
          ctx.defaultTeam,
        );
        ctx.output.emit({ id: created.id, identifier: created.identifier, url: created.url }, () =>
          ctx.output.success(`Created ${created.identifier}: ${created.url}`),
        );
      }),
    );

  // update ------------------------------------------------------------------
  issue
    .command("update [id]")
    .alias("edit")
    .description("Update an issue")
    .option("--title <title>", "new title")
    .option("-d, --description <text>", "new description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
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
          assignee: opts.assignee,
          state: opts.state,
          priority: opts.priority,
          project: opts.project,
          milestone: opts.milestone,
          cycle: opts.cycle,
          estimate: opts.estimate,
          parent: opts.parent,
          dueDate: opts.due,
          addLabel: opts.addLabel,
          removeLabel: opts.removeLabel,
          unassign: opts.unassign,
          clearCycle: opts.clearCycle,
        });
        ctx.output.emit({ id: updated.id, identifier: updated.identifier, url: updated.url }, () =>
          ctx.output.success(`Updated ${updated.identifier}`),
        );
      }),
    );

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
  issue
    .command("comment [id] [body]")
    .description("Add a comment to an issue")
    .option("--body-file <path>", "read comment body from a file ('-' = stdin)")
    .action(
      action(async (ctx: Context, opts, idArg?: string, bodyArg?: string) => {
        const body = resolveBody({ arg: bodyArg, file: opts.bodyFile, interactive: ctx.isTTY });
        if (!body) throw usageError("No comment body provided.");
        const { issue: iss, comment } = await svc.commentOnIssue(ctx.client, requireId(idArg), body);
        ctx.output.emit({ id: comment?.id, issue: iss.identifier }, () =>
          ctx.output.success(`Commented on ${iss.identifier}`),
        );
      }),
    );

  issue
    .command("comments [id]")
    .description("List comments on an issue")
    .action(
      action(async (ctx: Context, _opts, idArg?: string) => {
        const comments = await svc.listComments(ctx.client, requireId(idArg), ctx.limit);
        ctx.output.list(
          comments,
          [
            { key: "createdAt", header: "Date", value: (c) => c.createdAt.slice(0, 10) },
            { key: "user", header: "Author", value: (c) => c.user, max: 18 },
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
    .option("--web", "open the PR creation page in the browser")
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
  const comments = includeComments ? await svc.listComments(ctx.client, detail.id, 10) : [];
  ctx.output.detail({ ...detail, comments: includeComments ? comments : undefined }, [
    ["Issue", `${detail.identifier}  ${detail.title}`],
    ["State", detail.state],
    ["Priority", detail.priorityLabel],
    ["Assignee", detail.assignee],
    ["Team", detail.team],
    ["Project", detail.project],
    ["Milestone", detail.milestone],
    ["Cycle", detail.cycle],
    ["Parent", detail.parent],
    ["Estimate", detail.estimate],
    ["Labels", detail.labels.length ? detail.labels.join(", ") : null],
    ["Due", detail.dueDate],
    ["URL", detail.url],
    ["Updated", detail.updatedAt],
    ["Description", detail.description ? `\n${detail.description}` : null],
    ...(includeComments
      ? comments.map(
          (c) => [c.createdAt.slice(0, 10) + " " + c.user, c.body] as [string, unknown],
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
