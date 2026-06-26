/**
 * `linear cycle` (alias `c`) — work with team cycles (sprints).
 *
 * A team is required for list/current/create; it defaults to ctx.defaultTeam
 * when the optional [team] argument is omitted. `view`/`update` take a cycle id
 * (UUID), or a number/`current` when a team is in scope.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import type { Context } from "../context.js";
import * as svc from "../services/cycle.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.CycleRow>[] = [
  { key: "number", header: "#", value: (r) => r.number },
  { key: "name", header: "Name", value: (r) => r.name ?? "—", max: 24 },
  { key: "startsAt", header: "Starts", value: (r) => r.startsAt.slice(0, 10) },
  { key: "endsAt", header: "Ends", value: (r) => r.endsAt.slice(0, 10) },
  { key: "progress", header: "Progress", value: (r) => svc.formatProgress(r.progress) },
];

export function registerCycle(program: Command): void {
  const cycle = program.command("cycle").alias("c").description("Work with cycles");

  // list --------------------------------------------------------------------
  cycle
    .command("list [team]")
    .alias("ls")
    .description("List cycles for a team (defaults to the configured team)")
    .action(
      action(async (ctx: Context, _opts, teamArg?: string) => {
        const rows = await svc.listCycles(ctx.client, teamArg, ctx.limit, ctx.defaultTeam);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // view --------------------------------------------------------------------
  cycle
    .command("view <id>")
    .description("Show a cycle (by id, number, or 'current')")
    .action(
      action(async (ctx: Context, opts, id: string) => {
        const detail = await svc.getCycleDetail(ctx.client, id, opts.team ?? ctx.defaultTeam, ctx.defaultTeam);
        emitDetail(ctx, detail);
      }),
    );

  // current -----------------------------------------------------------------
  cycle
    .command("current [team]")
    .description("Show the team's currently active cycle")
    .action(
      action(async (ctx: Context, _opts, teamArg?: string) => {
        const detail = await svc.getCurrentCycle(ctx.client, teamArg, ctx.defaultTeam);
        emitDetail(ctx, detail);
      }),
    );

  // create ------------------------------------------------------------------
  cycle
    .command("create [team]")
    .alias("new")
    .description("Create a cycle")
    .requiredOption("--startsAt <date>", "start date/time (ISO, e.g. 2026-07-01)")
    .requiredOption("--endsAt <date>", "end date/time (ISO, e.g. 2026-07-14)")
    .option("--name <name>", "custom cycle name")
    .action(
      action(async (ctx: Context, opts, teamArg?: string) => {
        const created = await svc.createCycle(
          ctx.client,
          {
            team: teamArg ?? opts.team,
            name: opts.name,
            startsAt: opts.startsAt,
            endsAt: opts.endsAt,
          },
          ctx.defaultTeam,
        );
        ctx.output.emit({ id: created.id, number: created.number }, () =>
          ctx.output.success(`Created cycle #${created.number}`),
        );
      }),
    );

  // update ------------------------------------------------------------------
  cycle
    .command("update <id>")
    .alias("edit")
    .description("Update a cycle (by id, number, or 'current')")
    .option("--name <name>", "custom cycle name")
    .option("--startsAt <date>", "start date/time (ISO)")
    .option("--endsAt <date>", "end date/time (ISO)")
    .action(
      action(async (ctx: Context, opts, id: string) => {
        const updated = await svc.updateCycle(
          ctx.client,
          id,
          { name: opts.name, startsAt: opts.startsAt, endsAt: opts.endsAt },
          opts.team ?? ctx.defaultTeam,
          ctx.defaultTeam,
        );
        ctx.output.emit({ id: updated.id, number: updated.number }, () =>
          ctx.output.success(`Updated cycle #${updated.number}`),
        );
      }),
    );
}

function emitDetail(ctx: Context, detail: svc.CycleDetail): void {
  ctx.output.detail(detail, [
    ["Cycle", `#${detail.number}${detail.name ? `  ${detail.name}` : ""}`],
    ["Team", detail.team],
    ["Starts", detail.startsAt],
    ["Ends", detail.endsAt],
    ["Completed", detail.completedAt],
    ["Progress", svc.formatProgress(detail.progress)],
    ["Description", detail.description ? `\n${detail.description}` : null],
  ]);
}
