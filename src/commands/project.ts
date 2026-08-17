/**
 * `linear project` (alias `p`) — work with projects.
 */

import { Command, Option } from "commander";
import { action } from "../lib/action.js";
import { parseList, parseIntOption, addAliasOption, readAlias } from "../lib/options.js";
import { usageError } from "../lib/errors.js";
import { resolveBody } from "../lib/body.js";
import { confirmDestructive, promptInput } from "../lib/prompt.js";
import type { Context } from "../context.js";
import * as svc from "../services/project.js";
import type { Column } from "../output/table.js";

const ROW_COLUMNS: Column<svc.ProjectRow>[] = [
  { key: "name", header: "Name", value: (r) => r.name, max: 36 },
  { key: "state", header: "State", value: (r) => r.status?.name ?? r.state ?? "—", max: 14 },
  { key: "progress", header: "Progress", value: (r) => formatProgress(r.progress) },
  { key: "lead", header: "Lead", value: (r) => r.lead?.displayName ?? "—", max: 16 },
  { key: "target", header: "Target", value: (r) => r.targetDate ?? "—" },
];

function formatProgress(p: number | null): string {
  if (p === null || p === undefined) return "—";
  return `${Math.round(p * 100)}%`;
}

export function registerProject(program: Command): void {
  const project = program.command("project").alias("p").description("Work with projects");

  // list --------------------------------------------------------------------
  const list = project
    .command("list")
    .alias("ls")
    .description("List projects with filters")
    .option("--state <name>", "filter by status name or type (e.g. 'In QA', started)")
    .action(
      action(async (ctx: Context, opts) => {
        const rows = await svc.listProjects(
          ctx.client,
          {
            team: opts.team ?? ctx.defaultTeam,
            state: readAlias(opts, "--state", "--status"),
          },
          ctx.limit,
          ctx.defaultTeam,
        );
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );
  // `--status` is the reference CLI's spelling for the same thing; it shipped
  // earlier as a visible duplicate and now goes through the shared alias
  // mechanism, so `--help` shows one canonical spelling here like everywhere else.
  addAliasOption(list, "--status <name>", "--state");

  // view --------------------------------------------------------------------
  project
    .command("view <id>", { isDefault: true })
    .alias("show")
    .description("Show a project (by name or id)")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const detail = await svc.getProjectDetail(ctx.client, idArg);
        ctx.output.detail(detail, [
          ["Project", detail.name],
          ["Archived", detail.archivedAt ? `YES (${detail.archivedAt})` : null],
          ["State", detail.status?.name ?? detail.state],
          ["Health", detail.health],
          ["Progress", detail.progress !== null ? formatProgress(detail.progress) : null],
          ["Priority", detail.priorityLabel],
          ["Lead", detail.lead?.displayName ?? null],
          ["Teams", detail.teams.length ? detail.teams.map((t) => `${t.key} ${t.name}`).join(", ") : null],
          ["Members", detail.members.length ? detail.members.map((m) => m.displayName).join(", ") : null],
          ["Labels", detail.labels.length ? detail.labels.map((l) => l.name).join(", ") : null],
          ["Start", detail.startDate],
          ["Target", detail.targetDate],
          ["URL", detail.url],
          ["Updated", detail.updatedAt],
          ["Description", detail.description ? `\n${detail.description}` : null],
          ["Content", detail.content ? `\n${detail.content}` : null],
        ]);
      }),
    );

  // create ------------------------------------------------------------------
  const create = project
    .command("create")
    .alias("new")
    .description("Create a new project")
    .option("--name <name>", "project name")
    .option("-d, --description <text>", "project description (one-line summary)")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--content <text>", "project content (markdown body)")
    .option("--content-file <path>", "read content from a file ('-' = stdin)")
    .option("--teams <key>", "team (repeatable / comma-separated)", parseList)
    .option("--lead <who>", "project lead (me|email|name|id)")
    .option("--member <who>", "project member (repeatable / comma-separated)", parseList)
    .option("--state <name>", "initial status (name, type, or id)")
    .option("--start <date>", "planned start date (YYYY-MM-DD)")
    .option("--target <date>", "planned target date (YYYY-MM-DD)")
    .option("-P, --priority <0-4>", "priority (0 none, 1 urgent … 4 low)", parseIntOption)
    .option("-l, --label <name>", "project label (repeatable / comma-separated)", parseList)
    .option("--icon <name>", "Linear icon name, capitalized (e.g. Rocket)")
    .option("--color <hex>", "project color (e.g. #EB5757)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear project create --name 'Q3 Launch' --teams TES --lead me",
        "  linear project create --name Roadmap --teams TES,ENG --target 2026-09-30",
        "  linear project create --name API --teams TES --json | jq -r '.id'",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts) => {
        let name: string | undefined = opts.name;
        if (!name) name = await promptInput(ctx, "Name:", { required: true });
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: false,
        });
        const content = resolveBody({
          arg: opts.content,
          file: opts.contentFile,
          interactive: false,
        });
        const created = await svc.createProject(
          ctx.client,
          {
            name,
            description,
            content,
            team: opts.teams,
            lead: opts.lead,
            member: opts.member,
            state: opts.state,
            startDate: readAlias(opts, "--start", "--start-date"),
            targetDate: readAlias(opts, "--target", "--target-date"),
            priority: opts.priority,
            label: opts.label,
            icon: opts.icon,
            color: opts.color,
          },
          ctx.defaultTeam,
        );
        ctx.output.emit({ id: created.id, name: created.name, url: created.url }, () =>
          ctx.output.success(`Created ${created.name}: ${created.url}`),
        );
      }),
    );
  addAliasOption(create, "--start-date <date>", "--start");
  addAliasOption(create, "--target-date <date>", "--target");

  // update ------------------------------------------------------------------
  const update = project
    .command("update <id>")
    .alias("edit")
    .description("Update a project")
    .option("--name <name>", "new name")
    .option("-d, --description <text>", "new description (one-line summary)")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--content <text>", "new content (markdown body)")
    .option("--content-file <path>", "read content from a file ('-' = stdin)")
    .option("--teams <key>", "set teams (repeatable / comma-separated)", parseList)
    .option("--lead <who>", "project lead (me|email|name|id)")
    .option("--member <who>", "replace the members (repeatable / comma-separated)", parseList)
    .option("--state <name>", "status (name, type, or id)")
    .option("--start <date>", "planned start date (YYYY-MM-DD)")
    .option("--target <date>", "planned target date (YYYY-MM-DD)")
    .option("-P, --priority <0-4>", "priority (0 none, 1 urgent … 4 low)", parseIntOption)
    .option("-l, --label <name>", "replace the labels (repeatable / comma-separated)", parseList)
    .option("--icon <name>", "Linear icon name, capitalized (e.g. Rocket)")
    .option("--color <hex>", "project color (e.g. #EB5757)")
    // `-t/--team` is a global on every other command, so it is the flag a user
    // reaches for here too — and it did nothing at all: `project update --team X`
    // alone reported "Nothing to update", and alongside another flag it was
    // dropped without a word. Declaring it locally stops addGlobalOptions from
    // injecting the global, which lets the action reject it by name.
    //
    // Rejecting rather than implementing: a project belongs to *several* teams,
    // and `--teams` REPLACES that whole set. Quietly treating `--team TES` as
    // `--teams TES` would therefore remove every other team from the project —
    // a destructive reading of a flag the user almost certainly meant as "also
    // this team". Hidden, so `--help` and `linear commands --json` advertise
    // only `--teams`, the flag that works.
    .addOption(new Option("-t, --team <key>", "not supported here; use --teams").hideHelp())
    .action(
      action(async (ctx: Context, opts, idArg: string) => {
        if (opts.team !== undefined) {
          throw usageError(
            "--team does not apply to `project update`: a project belongs to several teams. " +
              "Use --teams <key,...> to set them (this replaces the project's current teams).",
          );
        }
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: false,
        });
        const content = resolveBody({
          arg: opts.content,
          file: opts.contentFile,
          interactive: false,
        });
        const updated = await svc.updateProject(ctx.client, idArg, {
          name: opts.name,
          description,
          content,
          team: opts.teams,
          lead: opts.lead,
          member: opts.member,
          state: opts.state,
          startDate: readAlias(opts, "--start", "--start-date"),
          targetDate: readAlias(opts, "--target", "--target-date"),
          priority: opts.priority,
          label: opts.label,
          icon: opts.icon,
          color: opts.color,
        });
        ctx.output.emit({ id: updated.id, name: updated.name, url: updated.url }, () =>
          ctx.output.success(`Updated ${updated.name}`),
        );
      }),
    );
  addAliasOption(update, "--start-date <date>", "--start");
  addAliasOption(update, "--target-date <date>", "--target");

  // archive -----------------------------------------------------------------
  project
    .command("archive <id>")
    .description("Archive a project")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const proj = await svc.getProjectDetail(ctx.client, idArg);
        if (!(await confirmDestructive(ctx, `Archive project ${proj.name}?`))) return;
        const archived = await svc.archiveProject(ctx.client, proj.id);
        ctx.output.emit({ id: archived.id, name: archived.name, archived: true }, () =>
          ctx.output.success(`Archived ${archived.name}`),
        );
      }),
    );

  // milestones --------------------------------------------------------------
  project
    .command("milestones <id>")
    .description("List a project's milestones")
    .action(
      action(async (ctx: Context, _opts, idArg: string) => {
        const rows = await svc.listMilestones(ctx.client, idArg, ctx.limit);
        ctx.output.list(
          rows,
          [
            { key: "name", header: "Name", value: (m) => m.name, max: 40 },
            { key: "target", header: "Target", value: (m) => m.targetDate ?? "—" },
            { key: "progress", header: "Progress", value: (m) => formatProgress(m.progress) },
          ],
          rows,
        );
      }),
    );
}
