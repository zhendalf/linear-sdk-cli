/**
 * `linear project` (alias `p`) — work with projects.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { parseList } from "../lib/options.js";
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
  project
    .command("list")
    .alias("ls")
    .description("List projects with filters")
    .option("--state <name>", "filter by project state/status (e.g. started, completed)")
    .action(
      action(async (ctx: Context, opts) => {
        const rows = await svc.listProjects(
          ctx.client,
          { team: opts.team ?? ctx.defaultTeam, state: opts.state },
          ctx.limit,
          ctx.defaultTeam,
        );
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

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
          ["State", detail.status ?? detail.state],
          ["Health", detail.health],
          ["Progress", detail.progress !== null ? formatProgress(detail.progress) : null],
          ["Priority", detail.priorityLabel],
          ["Lead", detail.lead],
          ["Teams", detail.teams.length ? detail.teams.join(", ") : null],
          ["Members", detail.members.length ? detail.members.join(", ") : null],
          ["Start", detail.startDate],
          ["Target", detail.targetDate],
          ["URL", detail.url],
          ["Updated", detail.updatedAt],
          ["Description", detail.description ? `\n${detail.description}` : null],
        ]);
      }),
    );

  // create ------------------------------------------------------------------
  project
    .command("create")
    .alias("new")
    .description("Create a new project")
    .option("--name <name>", "project name")
    .option("-d, --description <text>", "project description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--teams <key>", "team (repeatable / comma-separated)", parseList)
    .option("--lead <who>", "project lead (me|email|name|id)")
    .option("--state <name>", "initial status (name, type, or id)")
    .option("--start <date>", "planned start date (YYYY-MM-DD)")
    .option("--target <date>", "planned target date (YYYY-MM-DD)")
    .action(
      action(async (ctx: Context, opts) => {
        let name: string | undefined = opts.name;
        if (!name) name = await promptInput(ctx, "Name:", { required: true });
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: false,
        });
        const created = await svc.createProject(
          ctx.client,
          {
            name,
            description,
            team: opts.teams,
            lead: opts.lead,
            state: opts.state,
            startDate: opts.start,
            targetDate: opts.target,
          },
          ctx.defaultTeam,
        );
        ctx.output.emit({ id: created.id, name: created.name, url: created.url }, () =>
          ctx.output.success(`Created ${created.name}: ${created.url}`),
        );
      }),
    );

  // update ------------------------------------------------------------------
  project
    .command("update <id>")
    .alias("edit")
    .description("Update a project")
    .option("--name <name>", "new name")
    .option("-d, --description <text>", "new description")
    .option("--description-file <path>", "read description from a file ('-' = stdin)")
    .option("--teams <key>", "set teams (repeatable / comma-separated)", parseList)
    .option("--lead <who>", "project lead (me|email|name|id)")
    .option("--state <name>", "status (name, type, or id)")
    .option("--start <date>", "planned start date (YYYY-MM-DD)")
    .option("--target <date>", "planned target date (YYYY-MM-DD)")
    .action(
      action(async (ctx: Context, opts, idArg: string) => {
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: false,
        });
        const updated = await svc.updateProject(ctx.client, idArg, {
          name: opts.name,
          description,
          team: opts.teams,
          lead: opts.lead,
          state: opts.state,
          startDate: opts.start,
          targetDate: opts.target,
        });
        ctx.output.emit({ id: updated.id, name: updated.name, url: updated.url }, () =>
          ctx.output.success(`Updated ${updated.name}`),
        );
      }),
    );

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
