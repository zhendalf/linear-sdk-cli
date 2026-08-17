/**
 * `linear team` (alias `t`) — inspect and manage teams.
 *
 * The team key argument is optional on the sub-resource and view commands and
 * falls back to the configured default team (ctx.defaultTeam) when omitted.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import type { Context } from "../context.js";
import * as svc from "../services/team.js";
import type { Column } from "../output/table.js";

const TEAM_COLUMNS: Column<svc.TeamRow>[] = [
  { key: "key", header: "Key", value: (r) => r.key },
  { key: "name", header: "Name", value: (r) => r.name, max: 40 },
  { key: "id", header: "ID", value: (r) => r.id },
];

const MEMBER_COLUMNS: Column<svc.MemberRow>[] = [
  { key: "name", header: "Name", value: (r) => r.displayName, max: 24 },
  { key: "email", header: "Email", value: (r) => r.email, max: 40 },
  { key: "active", header: "Active", value: (r) => (r.active ? "yes" : "no") },
];

const STATE_COLUMNS: Column<svc.StateRow>[] = [
  { key: "name", header: "Name", value: (r) => r.name, max: 24 },
  { key: "type", header: "Type", value: (r) => r.type },
  { key: "color", header: "Color", value: (r) => r.color },
  { key: "position", header: "Pos", value: (r) => r.position },
];

const LABEL_COLUMNS: Column<svc.LabelRow>[] = [
  { key: "name", header: "Name", value: (r) => r.name, max: 30 },
  { key: "color", header: "Color", value: (r) => r.color },
];

const CYCLE_COLUMNS: Column<svc.CycleRow>[] = [
  { key: "number", header: "#", value: (r) => r.number },
  { key: "name", header: "Name", value: (r) => r.name ?? "—", max: 30 },
  { key: "startsAt", header: "Starts", value: (r) => (r.startsAt ? r.startsAt.slice(0, 10) : "—") },
  { key: "endsAt", header: "Ends", value: (r) => (r.endsAt ? r.endsAt.slice(0, 10) : "—") },
];

export function registerTeam(program: Command): void {
  const team = program.command("team").alias("t").description("Inspect and manage teams");

  // list --------------------------------------------------------------------
  team
    .command("list")
    .alias("ls")
    .description("List all teams")
    .action(
      action(async (ctx: Context) => {
        const rows = await svc.listTeams(ctx.client, ctx.limit);
        ctx.output.list(rows, TEAM_COLUMNS, rows);
      }),
    );

  // view --------------------------------------------------------------------
  team
    .command("view [key]")
    .description("Show a team (defaults to the configured team)")
    .action(
      action(async (ctx: Context, _opts, keyArg?: string) => {
        const detail = await svc.getTeamDetail(ctx.client, keyArg, ctx.defaultTeam);
        ctx.output.detail(detail, [
          ["Team", `${detail.key}  ${detail.name}`],
          ["ID", detail.id],
          ["Description", detail.description],
          ["Members", detail.memberCount],
          ["Issues", detail.issueCount],
          ["Cycles enabled", detail.cyclesEnabled ? "yes" : "no"],
          ["Private", detail.private ? "yes" : "no"],
          ["Timezone", detail.timezone],
          ["Color", detail.color],
          ["Created", detail.createdAt],
          ["Updated", detail.updatedAt],
        ]);
      }),
    );

  // members -----------------------------------------------------------------
  team
    .command("members [key]")
    .description("List a team's members")
    .option("--include-disabled", "include deactivated users (excluded by default)")
    .action(
      action(async (ctx: Context, opts, keyArg?: string) => {
        const rows = await svc.listMembers(
          ctx.client,
          keyArg,
          ctx.defaultTeam,
          ctx.limit,
          !!opts.includeDisabled,
        );
        ctx.output.list(rows, MEMBER_COLUMNS, rows);
      }),
    );

  // states ------------------------------------------------------------------
  team
    .command("states [key]")
    .description("List a team's workflow states")
    .action(
      action(async (ctx: Context, _opts, keyArg?: string) => {
        const rows = await svc.listStates(ctx.client, keyArg, ctx.defaultTeam, ctx.limit);
        ctx.output.list(rows, STATE_COLUMNS, rows);
      }),
    );

  // labels ------------------------------------------------------------------
  team
    .command("labels [key]")
    .description("List a team's labels")
    .action(
      action(async (ctx: Context, _opts, keyArg?: string) => {
        const rows = await svc.listLabels(ctx.client, keyArg, ctx.defaultTeam, ctx.limit);
        ctx.output.list(rows, LABEL_COLUMNS, rows);
      }),
    );

  // cycles ------------------------------------------------------------------
  team
    .command("cycles [key]")
    .description("List a team's cycles")
    .action(
      action(async (ctx: Context, _opts, keyArg?: string) => {
        const rows = await svc.listCycles(ctx.client, keyArg, ctx.defaultTeam, ctx.limit);
        ctx.output.list(rows, CYCLE_COLUMNS, rows);
      }),
    );

  // create ------------------------------------------------------------------
  team
    .command("create")
    .alias("new")
    .description("Create a new team")
    .option("--name <name>", "team name")
    .option("--key <key>", "team key (e.g. ENG); generated from the name if omitted")
    .option("-d, --description <text>", "team description")
    .option("--private", "make the team private (members only)")
    .action(
      action(async (ctx: Context, opts) => {
        let name: string | undefined = opts.name;
        if (!name) name = await promptInput(ctx, "Name:", { required: true });
        const created = await svc.createTeam(ctx.client, {
          name,
          key: opts.key,
          description: opts.description,
          private: !!opts.private,
        });
        ctx.output.emit({ id: created.id, key: created.key, name: created.name }, () =>
          ctx.output.success(`Created team ${created.key} (${created.name})`),
        );
      }),
    );

  // update ------------------------------------------------------------------
  team
    .command("update [key]")
    .alias("edit")
    .description("Update a team (defaults to the configured team)")
    .option("--name <name>", "new team name")
    .option("--key <key>", "new team key")
    .option("-d, --description <text>", "new team description")
    .action(
      action(async (ctx: Context, opts, keyArg?: string) => {
        const updated = await svc.updateTeam(ctx.client, keyArg, ctx.defaultTeam, {
          name: opts.name,
          key: opts.key,
          description: opts.description,
        });
        ctx.output.emit({ id: updated.id, key: updated.key, name: updated.name }, () =>
          ctx.output.success(`Updated team ${updated.key}`),
        );
      }),
    );

  // delete ------------------------------------------------------------------
  // The key is required here, unlike the other team commands: a delete that
  // silently fell back to the configured default team would be a disaster.
  team
    .command("delete <key>")
    .alias("rm")
    .description("Delete a team (admin); its issues go with it unless --move-issues")
    .option("--move-issues <team>", "move the team's issues to another team first")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear team delete OLD --move-issues ENG",
        "  linear team delete SCRATCH --yes",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts, keyArg: string) => {
        const plan = await svc.planDeleteTeam(ctx.client, keyArg, opts.moveIssues);
        const { team: t, issueCount, moveTo } = plan;
        const issues = `${issueCount} issue${issueCount === 1 ? "" : "s"}`;
        const question = moveTo
          ? `Delete team ${t.key} (${t.name}), moving its ${issues} to ${moveTo.key} first?`
          : `Delete team ${t.key} (${t.name}) and its ${issues}?`;
        if (!(await confirmDestructive(ctx, question))) return;
        let moved = 0;
        if (moveTo && issueCount > 0) {
          moved = await svc.moveTeamIssues(ctx.client, t, moveTo);
          ctx.output.info(`Moved ${moved} issue${moved === 1 ? "" : "s"} to ${moveTo.key}`);
        }
        await svc.deleteTeam(ctx.client, t);
        ctx.output.emit(
          {
            id: t.id,
            key: t.key,
            name: t.name,
            deleted: true,
            movedIssues: moved,
            movedTo: moveTo ? { id: moveTo.id, key: moveTo.key, name: moveTo.name } : null,
          },
          () => ctx.output.success(`Deleted team ${t.key} (${t.name})`),
        );
      }),
    );
}
