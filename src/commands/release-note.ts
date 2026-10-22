import { Command } from "commander";
import { action } from "../lib/action.js";
import { noteOptions, noteInput } from "../lib/release-input.js";
import { confirmDestructive } from "../lib/prompt.js";
import * as svc from "../services/release.js";

export function registerReleaseNote(program: Command): void {
  const group = program
    .command("release-note")
    .description("Manage Markdown notes covering one or more releases");
  group
    .command("list")
    .alias("ls")
    .description("List release notes with optional pipeline/release filters")
    .option("--pipeline <id|slug>", "filter by pipeline UUID or slug")
    .option("--release <id>", "filter by covered release UUID or slug")
    .option("--include-archived", "include archived notes")
    .action(
      action(async (ctx, opts) => {
        const rows = await svc.listNotes(ctx.client, ctx.limit, opts);
        ctx.output.list(
          rows,
          [
            { key: "id", header: "ID", value: (r) => r.id },
            { key: "title", header: "Title", value: (r) => r.title ?? "—" },
            { key: "pipeline", header: "Pipeline", value: (r) => r.pipeline.name },
            { key: "releaseCount", header: "Releases", value: (r) => r.releaseCount },
          ],
          rows,
        );
      }),
    );
  group
    .command("view <id>")
    .description("Show a release note and its Markdown body by UUID or slug")
    .action(
      action(async (ctx, _opts, id: string) => {
        const n = await svc.getNote(ctx.client, id);
        ctx.output.detail(n, [
          ["ID", n.id],
          ["Title", n.title],
          ["Pipeline", n.pipeline.name],
          ["Releases", n.releaseCount],
          ["First release", n.firstRelease?.name],
          ["Last release", n.lastRelease?.name],
          ["Generation status", n.generationStatus],
          ["Archived", n.archivedAt],
          ["URL", n.url],
          ["Content", n.content],
        ]);
      }),
    );
  noteOptions(
    group
      .command("create")
      .description("Create a note for explicit releases or an inclusive createdAt range"),
  )
    .requiredOption("--pipeline <id|slug>", "pipeline UUID or slug")
    .action(
      action(async (ctx, opts) => {
        const n = await svc.createNote(ctx.client, opts.pipeline, noteInput(opts));
        ctx.output.emit(n, () => ctx.output.success(`Created release note ${n.id}`));
      }),
    );
  noteOptions(
    group
      .command("update <id>")
      .description("Update a note's title, Markdown, or covered releases"),
  ).action(
    action(async (ctx, opts, id: string) => {
      const n = await svc.updateNote(ctx.client, id, noteInput(opts));
      ctx.output.emit(n, () => ctx.output.success(`Updated release note ${n.id}`));
    }),
  );
  group
    .command("delete <id>")
    .description("Delete a release note by UUID or slug")
    .action(
      action(async (ctx, _opts, id: string) => {
        const n = await svc.getNote(ctx.client, id);
        if (!(await confirmDestructive(ctx, `Delete release note ${n.title ?? n.id}?`))) return;
        const receipt = await svc.deleteNote(ctx.client, n.id);
        ctx.output.emit(receipt, () => ctx.output.success(`Deleted release note ${receipt.id}`));
      }),
    );
}
