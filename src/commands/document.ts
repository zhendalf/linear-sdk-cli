/**
 * `linear document` (alias `doc`) — work with documents.
 *
 * A document is attached to exactly one target: a project, issue, initiative,
 * team, cycle or release. `create` needs one (`--project`, `--issue`,
 * `--initiative`, `--team`, `--cycle`, `--release`; the configured team is the
 * fallback), `list` can filter by one, and `update` can re-point to one.
 * `--team` is the global flag: alone it names the team; with `--cycle` it
 * scopes the cycle lookup, as on the issue commands.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { resolveBody } from "../lib/body.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import { CYCLE_FLAG } from "../lib/options.js";
import { firstTeam, type Context } from "../context.js";
import * as svc from "../services/document.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.DocumentRow>[] = [
  { key: "title", header: "Title", value: (r) => r.title, max: 50 },
  { key: "target", header: "Attached to", value: (r) => svc.describeTarget(r) ?? "—", max: 40 },
  { key: "updatedAt", header: "Updated", value: (r) => r.updatedAt.slice(0, 10) },
];

/**
 * The six target flags, on `create`/`list`/`update` alike, worded for the verb.
 * `--team` is not declared here: it is the global `-t, --team`, read back off
 * the merged options so it works in either position (`linear -t ENG doc …`).
 */
function addTargetOptions(cmd: Command, verb: string): Command {
  return cmd
    .option("-p, --project <name>", `${verb} a project (name or id)`)
    .option("--issue <id>", `${verb} an issue (identifier or id)`)
    .option("--initiative <name>", `${verb} an initiative (name or id)`)
    .option(
      CYCLE_FLAG,
      `${verb} a cycle (number, name, id, or 'current'; team from --team or config)`,
    )
    .option("--release <name>", `${verb} a release (name, version, or id)`);
}

/** The target flags as typed, with `--team` taken from wherever on the command line it sat. */
function targetOptions(ctx: Context, opts: Record<string, any>): svc.DocumentTargetOptions {
  return {
    project: opts.project,
    issue: opts.issue,
    initiative: opts.initiative,
    team: firstTeam(ctx.options.team),
    cycle: opts.cycle,
    release: opts.release,
  };
}

export function registerDocument(program: Command): void {
  const document = program.command("document").alias("doc").description("Work with documents");

  // list --------------------------------------------------------------------
  const list = document
    .command("list")
    .alias("ls")
    .description("List workspace documents (optionally only those attached to one target)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear document list --project Roadmap",
        "  linear document list --issue TES-42",
        "  linear document list --team ENG            # the team's own documents",
        "  linear document list --cycle current       # in the configured team's active cycle",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts) => {
        // A configured default team does not filter here — documents are
        // workspace-wide, and hiding project documents behind a repo's team
        // would be a surprise. Only an explicit --team narrows.
        const rows = await svc.listDocuments(
          ctx.client,
          ctx.limit,
          targetOptions(ctx, opts),
          ctx.config.team,
        );
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );
  addTargetOptions(list, "only documents attached to");

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
          ["Attached to", svc.describeTarget(detail)],
          ["Creator", detail.creator?.displayName ?? null],
          ["URL", detail.url],
          ["Updated", detail.updatedAt],
          ["Content", detail.content ? `\n${detail.content}` : null],
        ]);
      }),
    );

  // create ------------------------------------------------------------------
  const create = document
    .command("create")
    .alias("new")
    .description(
      "Create a new document, attached to one target (--project, --issue, --initiative, --team, --cycle, or --release; default: the configured team)",
    )
    .option("--title <title>", "document title")
    .option("--content <text>", "document content (markdown body)")
    .option("--content-file <path>", "read content from a file ('-' = stdin)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear document create --title 'Spec' --project Roadmap --content-file spec.md",
        "  linear document create --title 'Notes' --issue TES-42",
        "  linear document create --title 'Retro' --cycle current --team ENG",
        "  linear document create --title 'Handbook'          # attached to the configured team",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts) => {
        // Validate the target flags before the title prompt or any file read.
        const target = targetOptions(ctx, opts);
        // The configured team is the fallback target — for create only — when
        // no target flag names one; it never overrides one that does.
        if (!svc.selectTarget(target) && ctx.config.team) target.team = ctx.config.team;
        let title: string | undefined = opts.title;
        if (!title) title = await promptInput(ctx, "Title:", { required: true });
        const content = resolveBody({
          arg: opts.content,
          file: opts.contentFile,
          interactive: false,
        });
        const created = await svc.createDocument(
          ctx.client,
          { title, content, ...target },
          ctx.config.team,
        );
        ctx.output.emit({ id: created.id, title: created.title, url: created.url }, () =>
          ctx.output.success(`Created ${created.title}: ${created.url}`),
        );
      }),
    );
  addTargetOptions(create, "attach to");

  // update ------------------------------------------------------------------
  const update = document
    .command("update <id>")
    .alias("edit")
    .description("Update a document's title or content, or re-point it to another target")
    .option("--title <title>", "new title")
    .option("--content <text>", "new content (markdown body)")
    .option("--content-file <path>", "read content from a file ('-' = stdin)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear document update <id> --title 'Spec v2'",
        "  linear document update <id> --content-file spec.md",
        "  linear document update <id> --issue TES-42       # move it onto the issue (replaces the old target)",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts, idArg: string) => {
        const content = resolveBody({
          arg: opts.content,
          file: opts.contentFile,
          interactive: false,
        });
        // Only the explicit --team re-points; a configured team never does.
        const updated = await svc.updateDocument(
          ctx.client,
          idArg,
          { title: opts.title, content, ...targetOptions(ctx, opts) },
          ctx.config.team,
        );
        ctx.output.emit({ id: updated.id, title: updated.title, url: updated.url }, () =>
          ctx.output.success(`Updated ${updated.title}`),
        );
      }),
    );
  addTargetOptions(update, "re-point to");

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
