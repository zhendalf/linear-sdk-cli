/**
 * `linear state` (alias `st`) — inspect a team's workflow states (read-only).
 *
 * The team argument is optional on `list` and falls back to the configured
 * default team (ctx.defaultTeam) when omitted. `view` takes a state id (UUID).
 * Creating/editing workflow states is admin-ish and intentionally out of scope.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import type { Context } from "../context.js";
import * as svc from "../services/state.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.StateRow>[] = [
  { key: "name", header: "Name", value: (r) => r.name, max: 24 },
  { key: "type", header: "Type", value: (r) => r.type },
  { key: "position", header: "Pos", value: (r) => r.position },
  { key: "color", header: "Color", value: (r) => r.color },
];

export function registerState(program: Command): void {
  const state = program.command("state").alias("st").description("Inspect workflow states");

  // list --------------------------------------------------------------------
  state
    .command("list [team]")
    .alias("ls")
    .description("List a team's workflow states (defaults to the configured team)")
    .action(
      action(async (ctx: Context, _opts, teamArg?: string) => {
        const rows = await svc.listStates(ctx.client, teamArg, ctx.defaultTeam, ctx.limit);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // view --------------------------------------------------------------------
  state
    .command("view <id>")
    .description("Show a workflow state (by id)")
    .action(
      action(async (ctx: Context, _opts, id: string) => {
        const detail = await svc.getStateDetail(ctx.client, id);
        ctx.output.detail(detail, [
          ["State", detail.name],
          ["ID", detail.id],
          ["Type", detail.type],
          ["Position", detail.position],
          ["Color", detail.color],
          ["Team", detail.team],
          ["Description", detail.description ? `\n${detail.description}` : null],
          ["Created", detail.createdAt],
          ["Updated", detail.updatedAt],
        ]);
      }),
    );
}
