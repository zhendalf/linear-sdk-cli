/**
 * `linear issue agent-session` — the sessions Linear's agent integrations open
 * on issues. Mounted under `issue` (from cli.ts) because a session lives on an
 * issue: `list` reads the issue from its argument or the current branch like
 * every other `issue` subcommand, and `--all-issues` widens to the workspace.
 */

import { Command, Option } from "commander";
import { action } from "../lib/action.js";
import { usageError } from "../lib/errors.js";
import { currentIssueId } from "../git.js";
import type { Context } from "../context.js";
import * as svc from "../services/agent-session.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.AgentSessionRow>[] = [
  { key: "status", header: "Status", value: (r) => r.status, max: 13 },
  { key: "agent", header: "Agent", value: (r) => r.agent?.displayName ?? "—", max: 20 },
  { key: "issue", header: "Issue", value: (r) => r.issue?.identifier ?? "—" },
  { key: "createdAt", header: "Created", value: (r) => r.createdAt.slice(0, 10) },
  {
    key: "summary",
    header: "Summary",
    value: (r) => r.summary?.replace(/\n/g, " ") ?? "—",
    max: 60,
  },
  { key: "id", header: "ID", value: (r) => r.id },
];

export function registerAgentSession(issue: Command): void {
  const group = issue
    .command("agent-session")
    .description("Inspect the agent sessions on an issue");

  // list --------------------------------------------------------------------
  group
    .command("list [issue]")
    .alias("ls")
    .description("List an issue's agent sessions (newest first)")
    .addOption(
      new Option("--status <status>", "only sessions in this status").choices([
        ...svc.AGENT_SESSION_STATUSES,
      ]),
    )
    .option("--all-issues", "every session in the workspace, ignoring the issue")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear issue agent-session list TES-123",
        "  linear issue agent-session list --all-issues --status awaitingInput",
        "  linear issue agent-session list TES-123 --json | jq -r '.[].id'",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts, issueArg?: string) => {
        const filters = { status: opts.status };
        let rows: svc.AgentSessionRow[];
        if (opts.allIssues) {
          if (issueArg !== undefined) {
            throw usageError("Pass either an issue or --all-issues, not both.");
          }
          rows = await svc.listAllAgentSessions(ctx.client, ctx.limit, filters);
        } else {
          const id = issueArg ?? currentIssueId();
          if (!id) {
            throw usageError(
              "No issue id given and none could be inferred from the current branch. " +
                "Pass an issue, or --all-issues for the whole workspace.",
            );
          }
          rows = await svc.listIssueAgentSessions(ctx.client, id, ctx.limit, filters);
        }
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // view --------------------------------------------------------------------
  group
    .command("view <id>")
    .alias("show")
    .description("Show an agent session and its activity")
    .action(
      action(async (ctx: Context, _opts, id: string) => {
        const d = await svc.getAgentSessionDetail(ctx.client, id);
        ctx.output.detail(d, [
          ["Session", d.id],
          ["Status", d.status],
          ["Agent", d.agent ? `${d.agent.name} (${d.agent.displayName})` : null],
          ["Creator", d.creator ? `${d.creator.name} (${d.creator.displayName})` : null],
          ["Issue", d.issue ? `${d.issue.identifier}  ${d.issue.title}` : null],
          ["Created", d.createdAt],
          ["Started", d.startedAt],
          ["Ended", d.endedAt],
          [
            "Dismissed",
            d.dismissedAt
              ? `${d.dismissedAt}${d.dismissedBy ? ` by ${d.dismissedBy.displayName}` : ""}`
              : null,
          ],
          ["External link", d.externalLink],
          ["URL", d.url],
          ["Summary", d.summary ? `\n${d.summary}` : null],
          ["Activity", d.activities.length ? `\n${renderActivities(d)}` : null],
        ]);
      }),
    );
}

/** `- <time> <type>: <one line>` per activity, oldest first, plus a truncation note. */
function renderActivities(d: svc.AgentSessionDetail): string {
  const lines = d.activities.map((a) => {
    const when = a.createdAt.slice(11, 19);
    const text =
      a.action !== null ? `${a.action}${a.parameter ? `: ${a.parameter}` : ""}` : (a.body ?? "");
    return `- ${when} ${a.type}: ${text.replace(/\s*\n\s*/g, " ")}`;
  });
  if (d.activitiesTruncated) lines.push(`… more activities not shown (use --json)`);
  return lines.join("\n");
}
