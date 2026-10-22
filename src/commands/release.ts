import { Command, Option } from "commander";
import { action } from "../lib/action.js";
import {
  descriptionOptions,
  releaseInput,
  lifecycleOptions,
  lifecycleInput,
  issueReferences,
  repeat,
  STAGE_TYPES,
} from "../lib/release-input.js";
import { confirmDestructive } from "../lib/prompt.js";
import * as svc from "../services/release.js";
import type { Context } from "../context.js";
import type { Column } from "../output/table.js";

const COLUMNS: Column<svc.ReleaseRow>[] = [
  { key: "id", header: "ID", value: (r) => r.id },
  { key: "name", header: "Name", value: (r) => r.name },
  { key: "version", header: "Version", value: (r) => r.version ?? "—" },
  { key: "pipeline", header: "Pipeline", value: (r) => r.pipeline.name },
  { key: "stage", header: "Stage", value: (r) => r.stage.name },
];
function emit(ctx: Context, value: svc.ReleaseDetail, verb: string): void {
  ctx.output.emit(value, () => ctx.output.success(`${verb} release ${value.name} (${value.id})`));
}
function editOptions(command: Command, creating = false): Command {
  const result = descriptionOptions(command)
    .option("--name <name>", "release name")
    .option("--release-version <version>", "release version (unique within the pipeline)")
    .option("--commit-sha <sha>", "full Git commit SHA")
    .option("--stage <id>", "stage UUID from the same pipeline")
    .option("--start-date <date>", "estimated start date (YYYY-MM-DD)")
    .option("--target-date <date>", "estimated completion date (YYYY-MM-DD)");
  if (creating) result.options.find((o) => o.long === "--name")!.makeOptionMandatory();
  return result;
}
export function registerRelease(program: Command): void {
  const group = program
    .command("release")
    .description("Track releases and issue membership (Business/Enterprise)")
    .addHelpText(
      "after",
      "\nUse pipeline UUIDs/slugs and explicit versions for lifecycle operations.\nGit scanning and pipeline access keys: https://github.com/linear/linear-release\nCompleting a scheduled release may move open issues to the next release.",
    );
  group
    .command("list")
    .alias("ls")
    .description("List releases, optionally scoped to a pipeline")
    .option("--pipeline <id|slug>", "filter by pipeline UUID or slug")
    .option("--release-version <version>", "filter by exact version")
    .addOption(
      new Option("--stage-type <type>", "filter by lifecycle stage type").choices(STAGE_TYPES),
    )
    .option("--include-archived", "include archived releases")
    .action(
      action(async (ctx, opts) => {
        const rows = await svc.listReleases(ctx.client, ctx.limit, {
          pipeline: opts.pipeline,
          version: opts.releaseVersion,
          stageType: opts.stageType,
          includeArchived: opts.includeArchived,
        });
        ctx.output.list(rows, COLUMNS, rows);
      }),
    );
  group
    .command("view <id>")
    .description("Show a release by UUID or slug")
    .action(
      action(async (ctx, _opts, id: string) => {
        const r = await svc.getRelease(ctx.client, id);
        ctx.output.detail(r, [
          ["ID", r.id],
          ["Name", r.name],
          ["Version", r.version],
          ["Commit SHA", r.commitSha],
          ["Pipeline", r.pipeline.name],
          ["Stage", r.stage.name],
          ["Start date", r.startDate],
          ["Target date", r.targetDate],
          ["Started", r.startedAt],
          ["Completed", r.completedAt],
          ["Canceled", r.canceledAt],
          ["Archived", r.archivedAt],
          ["Issues", r.issueCount],
          ["URL", r.url],
          ["Description", r.description],
        ]);
      }),
    );
  editOptions(
    group
      .command("create")
      .alias("new")
      .description("Create a release (stage defaults depend on pipeline type)"),
    true,
  )
    .requiredOption("--pipeline <id|slug>", "pipeline UUID or slug")
    .action(
      action(async (ctx, opts) =>
        emit(
          ctx,
          await svc.createRelease(ctx.client, opts.pipeline, {
            ...releaseInput(opts),
            name: opts.name,
          }),
          "Created",
        ),
      ),
    );
  editOptions(
    group
      .command("update <id>")
      .alias("edit")
      .description("Update exact release metadata or stage by UUID/slug"),
  ).action(
    action(async (ctx, opts, id: string) =>
      emit(ctx, await svc.updateRelease(ctx.client, id, releaseInput(opts)), "Updated"),
    ),
  );
  lifecycleOptions(
    group
      .command("sync")
      .description("Sync explicit issue references; continuous pipelines complete immediately"),
  )
    .requiredOption("--commit-sha <sha>", "full Git commit SHA (no implicit checkout scanning)")
    .option(
      "--issue <key[=sha]>",
      "issue reference, defaulting to --commit-sha (repeatable)",
      repeat,
    )
    .option(
      "--reverted-issue <key[=sha]>",
      "reverted issue reference to remove (repeatable)",
      repeat,
    )
    .addHelpText(
      "after",
      "\nScheduled sync may label an unversioned started release or create a release.\nIssue references accumulate; omitted issues are not removed. Use --reverted-issue\nor release remove-issue for removal. Use linear-release for Git/PR attribution.",
    )
    .action(
      action(async (ctx, opts) =>
        emit(
          ctx,
          await svc.syncRelease(ctx.client, opts.pipeline, opts.releaseVersion, {
            ...lifecycleInput(opts),
            commitSha: opts.commitSha,
            issueReferences: issueReferences(opts.issue, opts.commitSha),
            revertedIssueReferences: issueReferences(opts.revertedIssue, opts.commitSha),
          }),
          "Synced",
        ),
      ),
    );
  lifecycleOptions(
    group
      .command("update-version")
      .description("Update stage/name/links for an explicit pipeline and release version"),
  )
    .option("--stage <name>", "stage name (Linear matches exact name, then normalized name)")
    .action(
      action(async (ctx, opts) =>
        emit(
          ctx,
          await svc.updateReleaseVersion(ctx.client, opts.pipeline, opts.releaseVersion, {
            ...lifecycleInput(opts),
            stage: opts.stage,
          }),
          "Updated",
        ),
      ),
    );
  lifecycleOptions(
    group
      .command("complete")
      .description("Complete an explicit scheduled release; may roll open issues forward"),
  )
    .option(
      "--commit-sha <sha>",
      "full SHA (Linear preserves an existing SHA when targeting a version)",
    )
    .addHelpText(
      "after",
      "\nComplete only after your deployment and verification gates pass. This command\nrecords lifecycle state; it does not deploy or verify code.",
    )
    .action(
      action(async (ctx, opts) =>
        emit(
          ctx,
          await svc.completeRelease(ctx.client, opts.pipeline, opts.releaseVersion, {
            ...lifecycleInput(opts),
            commitSha: opts.commitSha,
          }),
          "Completed",
        ),
      ),
    );
  group
    .command("issues <id>")
    .description("List issues in a release (UUID or slug)")
    .action(
      action(async (ctx, _opts, id: string) => {
        const rows = await svc.listReleaseIssues(ctx.client, id, ctx.limit);
        ctx.output.list(
          rows,
          [
            { key: "identifier", header: "Issue", value: (r) => r.identifier },
            { key: "title", header: "Title", value: (r) => r.title },
          ],
          rows,
        );
      }),
    );
  group
    .command("links <id>")
    .description("List external links on a release (UUID or slug)")
    .action(
      action(async (ctx, _opts, id: string) => {
        const rows = await svc.listReleaseLinks(ctx.client, id, ctx.limit);
        ctx.output.list(
          rows,
          [
            { key: "label", header: "Label", value: (r) => r.label ?? "—" },
            { key: "url", header: "URL", value: (r) => r.url },
          ],
          rows,
        );
      }),
    );
  group
    .command("add-issue <id> <issue>")
    .description("Add an issue (KEY-123 or UUID) to an exact release")
    .action(
      action(async (ctx, _opts, id: string, issue: string) => {
        const receipt = await svc.addIssue(ctx.client, id, issue);
        ctx.output.emit(receipt, () =>
          ctx.output.success(`Added ${receipt.identifier} to release ${receipt.releaseId}`),
        );
      }),
    );
  group
    .command("remove-issue <id> <issue>")
    .description("Remove an issue from an exact release")
    .action(
      action(async (ctx, _opts, id: string, issue: string) => {
        if (!(await confirmDestructive(ctx, `Remove ${issue} from release ${id}?`))) return;
        const receipt = await svc.removeIssue(ctx.client, id, issue);
        ctx.output.emit(receipt, () =>
          ctx.output.success(`Removed ${issue} from release ${receipt.releaseId}`),
        );
      }),
    );
}
