/**
 * `linear issue attach <issue> <file...>` — upload files to Linear's storage
 * and attach them to an issue (TES-602). Mounted under `issue` (from cli.ts)
 * rather than under the `attachment` group: it is the reference CLI's
 * spelling, and the workflow is an issue workflow — `attachment create` stays
 * the URL-only form.
 *
 * Private by default: the asset URL is readable by workspace members only,
 * like an upload from the Linear app. `--public` puts a raster image on a
 * world-readable URL and says so on stderr; for anything else it is a usage
 * error, before any bytes move. Every file is validated before the first
 * upload, so a typo in file 3 does not leave files 1–2 uploaded and orphaned.
 *
 * A sidebar attachment does not render an image inline; `--comment <body>`
 * also posts one comment embedding every file as markdown (`![name](url)` for
 * images, `[name](url)` otherwise) so it shows in the thread too.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { formatBytes, isImage } from "../lib/upload.js";
import type { Context } from "../context.js";
import * as svc from "../services/attachment.js";

export function registerAttach(issue: Command): void {
  issue
    .command("attach <issue> <file...>")
    .description("Upload files and attach them to an issue (private by default)")
    .option("--title <title>", "attachment title (single file only; default: the file name)")
    .option("--comment <body>", "also post a comment with this body embedding the files as markdown")
    .option("--public", "upload to a public, world-readable URL (raster images only; default: private)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear issue attach TES-42 screenshot.png",
        "  linear issue attach TES-42 repro.log trace.json --comment 'Logs from the failing run'",
        "  linear issue attach TES-42 shot.png --json | jq -r '.[].assetUrl'",
        "",
        "Files are private (workspace members only) unless --public is given, which Linear",
        "allows for raster images only. Sidebar attachments do not render images inline —",
        "use --comment here, or 'linear comment add <issue> --attach <file>', for that.",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts, issueArg: string, files: string[]) => {
        const result = await svc.attachFiles(ctx.client, issueArg, files, {
          title: opts.title,
          comment: opts.comment,
          public: opts.public === true,
          onAttached: (a, iss) => {
            ctx.output.success(`Attached ${a.filename} (${formatBytes(a.size)}) to ${iss.identifier}`);
            if (a.public) ctx.output.warn(`${a.filename} is on a public URL, readable by anyone: ${a.assetUrl}`);
          },
        });
        const identifier = result.issue.identifier;
        if (result.comment) ctx.output.success(`Commented on ${identifier}`);
        else if (result.attachments.some((a) => isImage(a.contentType))) {
          ctx.output.info(
            "Hint: sidebar attachments do not render images inline. To show one in the thread: " +
              `linear comment add ${identifier} --attach <file> (or --comment here).`,
          );
        }
        ctx.output.emit(
          result.attachments.map((a) => ({
            id: a.id,
            title: a.title,
            url: a.url,
            assetUrl: a.assetUrl,
            contentType: a.contentType,
            size: a.size,
            ...(result.comment ? { comment: result.comment } : {}),
          })),
          () => {},
        );
      }),
    );
}
