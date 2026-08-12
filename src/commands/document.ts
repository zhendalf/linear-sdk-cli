/**
 * `linear document` (alias `doc`) — work with workspace documents.
 *
 * Documents are workspace-scoped (no team). `view`/`update`/`delete` take a
 * document id (UUID or slugId); `create` needs a title and optionally content
 * (flag, file, or stdin via resolveBody) and a related project.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { resolveBody } from "../lib/body.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import type { Context } from "../context.js";
import * as svc from "../services/document.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.DocumentRow>[] = [
  { key: "title", header: "Title", value: (r) => r.title, max: 50 },
  { key: "project", header: "Project", value: (r) => r.project?.name ?? "—", max: 30 },
  { key: "updatedAt", header: "Updated", value: (r) => r.updatedAt.slice(0, 10) },
];

export function registerDocument(program: Command): void {
  const document = program.command("document").alias("doc").description("Work with documents");

  // list --------------------------------------------------------------------
  document
    .command("list")
    .alias("ls")
    .description("List workspace documents")
    .option("-p, --project <name>", "only documents in a project (name or id)")
    .option("--issue <id>", "only documents on an issue (identifier or id)")
    .action(
      action(async (ctx: Context, opts) => {
        const rows = await svc.listDocuments(ctx.client, ctx.limit, {
          project: opts.project,
          issue: opts.issue,
        });
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  // view --------------------------------------------------------------------
  document
    .command("view <id>", { isDefault: true })
    .alias("show")
    .description("Show a document, including its markdown content")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const detail = await svc.getDocumentDetail(ctx.client, idArg);
        ctx.output.detail(detail, [
          ["Document", detail.title],
          ["Project", detail.project],
          ["Issue", detail.issue],
          ["Creator", detail.creator],
          ["URL", detail.url],
          ["Updated", detail.updatedAt],
          ["Content", detail.content ? `\n${detail.content}` : null],
        ]);
      }),
    );

  // create ------------------------------------------------------------------
  document
    .command("create")
    .alias("new")
    .description("Create a new document")
    .option("--title <title>", "document title")
    .option("--content <text>", "document content (markdown body)")
    .option("--content-file <path>", "read content from a file ('-' = stdin)")
    .option("-p, --project <name>", "container: a project (name or id)")
    .option("--issue <id>", "container: an issue (identifier or id)")
    .description(
      "Create a new document (requires a container: --project, --issue, or --team)",
    )
    .action(
      action(async (ctx: Context, opts) => {
        let title: string | undefined = opts.title;
        if (!title) title = await promptInput(ctx, "Title:", { required: true });
        const content = resolveBody({
          arg: opts.content,
          file: opts.contentFile,
          interactive: false,
        });
        const created = await svc.createDocument(ctx.client, {
          title,
          content,
          project: opts.project,
          issue: opts.issue,
          // The global --team (ctx.defaultTeam) is only a *fallback* container —
          // never combined with an explicit --project/--issue (else two containers).
          team: opts.project || opts.issue ? undefined : ctx.defaultTeam,
        });
        ctx.output.emit({ id: created.id, title: created.title, url: created.url }, () =>
          ctx.output.success(`Created ${created.title}: ${created.url}`),
        );
      }),
    );

  // update ------------------------------------------------------------------
  document
    .command("update <id>")
    .alias("edit")
    .description("Update a document")
    .option("--title <title>", "new title")
    .option("--content <text>", "new content (markdown body)")
    .option("--content-file <path>", "read content from a file ('-' = stdin)")
    .action(
      action(async (ctx: Context, opts, idArg: string) => {
        const content = resolveBody({
          arg: opts.content,
          file: opts.contentFile,
          interactive: false,
        });
        const updated = await svc.updateDocument(ctx.client, idArg, {
          title: opts.title,
          content,
        });
        ctx.output.emit({ id: updated.id, title: updated.title, url: updated.url }, () =>
          ctx.output.success(`Updated ${updated.title}`),
        );
      }),
    );

  // delete ------------------------------------------------------------------
  document
    .command("delete <id>")
    .alias("rm")
    .description("Delete (trash) a document")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const doc = await svc.getDocumentDetail(ctx.client, idArg);
        if (!(await confirmDestructive(ctx, `Delete document ${doc.title}?`))) return;
        const deleted = await svc.deleteDocument(ctx.client, doc.id);
        ctx.output.emit({ id: deleted.id, title: deleted.title, deleted: true }, () =>
          ctx.output.success(`Deleted ${deleted.title}`),
        );
      }),
    );
}
