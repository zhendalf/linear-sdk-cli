import { Command, Option } from "commander";
import { action } from "../lib/action.js";
import { booleanValue, finiteNumber, STAGE_TYPES } from "../lib/release-input.js";
import * as svc from "../services/release.js";

function options(command: Command, creating = false): Command {
  const result = command
    .option("--name <name>", "stage name")
    .option("--color <hex>", "six-digit HEX color")
    .option("--position <number>", "stage ordering position", finiteNumber)
    .option(
      "--frozen <boolean>",
      "exclude this started stage from automated sync (true|false)",
      booleanValue,
    );
  if (creating)
    for (const flag of ["--name", "--color", "--position"])
      result.options.find((o) => o.long === flag)!.makeOptionMandatory();
  return result;
}
function input(opts: Record<string, any>): svc.StageInput {
  return { name: opts.name, color: opts.color, position: opts.position, frozen: opts.frozen };
}
export function registerReleaseStage(program: Command): void {
  const group = program
    .command("release-stage")
    .description("Manage release stages and freeze scheduled release scope")
    .addHelpText(
      "after",
      "\nOnly started stages can be frozen. Frozen stages exclude their releases from\nautomated sync; at least one started stage must remain unfrozen. Stage types\nare immutable. Linear enforces pipeline stage invariants.",
    );
  group
    .command("list <pipeline>")
    .alias("ls")
    .description("List stages for a pipeline UUID or slug")
    .option("--include-archived", "include archived stages")
    .action(
      action(async (ctx, opts, pipeline: string) => {
        const rows = await svc.listStages(ctx.client, pipeline, ctx.limit, opts.includeArchived);
        ctx.output.list(
          rows,
          [
            { key: "id", header: "ID", value: (r) => r.id },
            { key: "name", header: "Name", value: (r) => r.name },
            { key: "type", header: "Type", value: (r) => r.type },
            { key: "position", header: "Position", value: (r) => r.position },
            { key: "frozen", header: "Frozen", value: (r) => r.frozen },
          ],
          rows,
        );
      }),
    );
  group
    .command("view <id>")
    .description("Show a release stage by UUID")
    .action(
      action(async (ctx, _opts, id: string) => {
        const s = await svc.getStage(ctx.client, id);
        ctx.output.detail(s, [
          ["ID", s.id],
          ["Name", s.name],
          ["Type", s.type],
          ["Color", s.color],
          ["Position", s.position],
          ["Frozen", s.frozen],
          ["Pipeline", s.pipeline.name],
          ["Archived", s.archivedAt],
        ]);
      }),
    );
  options(group.command("create").description("Create a stage in a release pipeline"), true)
    .requiredOption("--pipeline <id|slug>", "pipeline UUID or slug")
    .addOption(
      new Option("--type <type>", "lifecycle stage type")
        .choices(STAGE_TYPES)
        .makeOptionMandatory(),
    )
    .action(
      action(async (ctx, opts) => {
        const s = await svc.createStage(ctx.client, opts.pipeline, {
          ...input(opts),
          name: opts.name,
          color: opts.color,
          position: opts.position,
          type: opts.type,
        });
        ctx.output.emit(s, () => ctx.output.success(`Created release stage ${s.name} (${s.id})`));
      }),
    );
  options(
    group
      .command("update <id>")
      .description("Update name, color, order, or frozen state by stage UUID"),
  ).action(
    action(async (ctx, opts, id: string) => {
      const s = await svc.updateStage(ctx.client, id, input(opts));
      ctx.output.emit(s, () => ctx.output.success(`Updated release stage ${s.name} (${s.id})`));
    }),
  );
}
