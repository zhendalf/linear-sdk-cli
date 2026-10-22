import { Command, Option } from "commander";
import { action } from "../lib/action.js";
import { booleanValue, repeat, PIPELINE_TYPES } from "../lib/release-input.js";
import * as svc from "../services/release.js";

function options(command: Command, creating = false): Command {
  const result = command
    .option("--name <name>", "pipeline name")
    .addOption(new Option("--type <type>", "pipeline type").choices(PIPELINE_TYPES))
    .option(
      "--production <boolean>",
      "whether pipeline targets production (true|false)",
      booleanValue,
    )
    .option(
      "--auto-release-notes <boolean>",
      "automatically generate notes on completion (true|false)",
      booleanValue,
    )
    .option(
      "--rollover-issues <boolean>",
      "move open issues to the next scheduled release on completion (true|false)",
      booleanValue,
    )
    .addOption(
      new Option("--include-path <glob>", "replace path patterns with these globs (repeatable)")
        .argParser(repeat)
        .conflicts("clearPaths"),
    )
    .addOption(new Option("--clear-paths", "clear all path filters").conflicts("includePath"))
    .addOption(
      new Option("--team-id <uuid>", "replace associated teams with these UUIDs (repeatable)")
        .argParser(repeat)
        .conflicts("clearTeams"),
    )
    .addOption(new Option("--clear-teams", "clear team associations").conflicts("teamId"));
  if (creating)
    for (const flag of ["--name", "--type"])
      result.options.find((o) => o.long === flag)!.makeOptionMandatory();
  return result;
}
function input(opts: Record<string, any>): svc.PipelineInput {
  return {
    name: opts.name,
    type: opts.type,
    isProduction: opts.production,
    autoGenerateReleaseNotesOnCompletion: opts.autoReleaseNotes,
    rolloverIssuesOnCompletion: opts.rolloverIssues,
    includePathPatterns: opts.clearPaths ? [] : opts.includePath,
    teamIds: opts.clearTeams ? [] : opts.teamId,
  };
}
export function registerReleasePipeline(program: Command): void {
  const group = program
    .command("release-pipeline")
    .description("Manage release pipelines (Business/Enterprise)")
    .addHelpText(
      "after",
      "\nUse normal Linear OAuth/API credentials. Pipeline access keys belong to\nlinear-release and cannot replace these credentials. Creating a pipeline\ncreates default stages; entitlement and workspace permissions are enforced by Linear.",
    );
  group
    .command("list")
    .alias("ls")
    .description("List workspace release pipelines")
    .option("--include-archived", "include archived pipelines")
    .action(
      action(async (ctx, opts) => {
        const rows = await svc.listPipelines(ctx.client, ctx.limit, opts.includeArchived);
        ctx.output.list(
          rows,
          [
            { key: "id", header: "ID", value: (r) => r.id },
            { key: "name", header: "Name", value: (r) => r.name },
            { key: "type", header: "Type", value: (r) => r.type },
            { key: "slugId", header: "Slug", value: (r) => r.slugId },
          ],
          rows,
        );
      }),
    );
  group
    .command("view <id>")
    .description("Show pipeline settings by UUID or slug")
    .action(
      action(async (ctx, _opts, id: string) => {
        const p = await svc.getPipeline(ctx.client, id);
        ctx.output.detail(p, [
          ["ID", p.id],
          ["Name", p.name],
          ["Slug", p.slugId],
          ["Type", p.type],
          ["Production", p.isProduction],
          ["Auto release notes", p.autoGenerateReleaseNotesOnCompletion],
          ["Rollover issues", p.rolloverIssuesOnCompletion],
          ["Path patterns", p.includePathPatterns.join(", ")],
          ["Archived", p.archivedAt],
          ["URL", p.url],
        ]);
      }),
    );
  options(
    group.command("create").description("Create a pipeline with default stages"),
    true,
  ).action(
    action(async (ctx, opts) => {
      const p = await svc.createPipeline(ctx.client, {
        ...input(opts),
        name: opts.name,
        type: opts.type,
      });
      ctx.output.emit(p, () => ctx.output.success(`Created release pipeline ${p.name} (${p.id})`));
    }),
  );
  options(
    group.command("update <id>").description("Update pipeline settings by UUID or slug"),
  ).action(
    action(async (ctx, opts, id: string) => {
      const p = await svc.updatePipeline(ctx.client, id, input(opts));
      ctx.output.emit(p, () => ctx.output.success(`Updated release pipeline ${p.name} (${p.id})`));
    }),
  );
}
