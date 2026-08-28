/** `linear custom-view` (alias `cv`) — manage saved custom views. */

import { Command, Option } from "commander";
import type { Context } from "../context.js";
import { action } from "../lib/action.js";
import { resolveBody } from "../lib/body.js";
import { usageError } from "../lib/errors.js";
import { parseJsonObjectInput } from "../lib/json-input.js";
import { confirmDestructive, promptInput, promptSelect } from "../lib/prompt.js";
import type { Column } from "../output/table.js";
import * as svc from "../services/custom-view.js";

const ROW_COLUMNS: Column<svc.CustomViewRow>[] = [
  { key: "name", header: "Name", value: (row) => row.name, max: 40 },
  { key: "type", header: "Type", value: (row) => row.type, max: 12 },
  { key: "shared", header: "Shared", value: (row) => (row.shared ? "yes" : "no") },
  { key: "owner", header: "Owner", value: (row) => row.owner?.displayName ?? "—", max: 24 },
  {
    key: "team",
    header: "Team",
    value: (row) => (row.team ? `${row.team.key} ${row.team.name}` : "—"),
    max: 28,
  },
  { key: "id", header: "ID", value: (row) => row.id },
];

const RESULT_COLUMNS: Column<svc.CustomViewResultRow>[] = [
  { key: "type", header: "Type", value: (row) => row.type, max: 12 },
  { key: "identifier", header: "Key", value: (row) => row.identifier ?? "—", max: 16 },
  { key: "name", header: "Name", value: (row) => row.name, max: 60 },
  { key: "id", header: "ID", value: (row) => row.id },
];

function filterFrom(opts: Record<string, any>): Record<string, unknown> | undefined {
  return parseJsonObjectInput({ inline: opts.filter, file: opts.filterFile, label: "filter" });
}

function visibility(opts: Record<string, any>): boolean | undefined {
  if (opts.shared && opts.personal) {
    throw usageError("Pass either --shared or --personal, not both.");
  }
  if (opts.shared) return true;
  if (opts.personal) return false;
  return undefined;
}

function addFilterOptions(command: Command): Command {
  return command
    .addOption(
      new Option("--filter <json>", "typed Linear filter as a JSON object").conflicts("filterFile"),
    )
    .addOption(
      new Option(
        "--filter-file <path>",
        "read the filter JSON from a file ('-' = stdin)",
      ).conflicts("filter"),
    );
}

function addVisibilityOptions(command: Command): Command {
  return command
    .addOption(new Option("--shared", "share the view with the workspace").conflicts("personal"))
    .addOption(new Option("--personal", "make the view owner-only").conflicts("shared"));
}

function addDescriptionOptions(command: Command, update = false): Command {
  command
    .addOption(
      new Option("-d, --description <text>", update ? "new description" : "view description")
        .conflicts("descriptionFile")
        .conflicts("clearDescription"),
    )
    .addOption(
      new Option("--description-file <path>", "read description from a file ('-' = stdin)")
        .conflicts("description")
        .conflicts("clearDescription"),
    );
  return command;
}

function receipt(view: any) {
  return {
    id: view.id,
    name: view.name,
    type: svc.customViewType(view.modelName),
    shared: view.shared,
    slugId: view.slugId,
  };
}

export function registerCustomView(program: Command): void {
  const customView = program
    .command("custom-view")
    .alias("cv")
    .description("Create and manage saved custom views");

  customView
    .command("list")
    .alias("ls")
    .description("List accessible workspace and team custom views")
    .action(
      action(async (ctx: Context) => {
        const rows = await svc.listCustomViews(ctx.client, ctx.limit);
        ctx.output.list(rows, ROW_COLUMNS, rows);
      }),
    );

  customView
    .command("view <id>", { isDefault: true })
    .alias("show")
    .description("Show a custom view by UUID")
    .action(
      action(async (ctx: Context, _opts, id: string) => {
        const detail = await svc.getCustomViewDetail(ctx.client, id);
        ctx.output.detail(detail, [
          ["Name", detail.name],
          ["Type", detail.type],
          ["Visibility", detail.shared ? "shared" : "personal"],
          ["Owner", detail.owner?.displayName],
          ["Creator", detail.creator?.displayName],
          ["Team", detail.team ? `${detail.team.key} ${detail.team.name}` : null],
          ["Description", detail.description],
          ["Filter", JSON.stringify(detail.filter)],
          ["Color", detail.color],
          ["Icon", detail.icon],
          ["Slug", detail.slugId],
          ["Created", detail.createdAt],
          ["Updated", detail.updatedAt],
          ["Archived", detail.archivedAt],
          ["ID", detail.id],
        ]);
      }),
    );

  customView
    .command("results <id>")
    .alias("items")
    .description("List issues, projects, or initiatives matched by a view UUID")
    .action(
      action(async (ctx: Context, _opts, id: string) => {
        const rows = await svc.listCustomViewResults(ctx.client, id, ctx.limit);
        ctx.output.list(rows, RESULT_COLUMNS, rows, { empty: "(view matches no entities)" });
      }),
    );

  let create = customView
    .command("create")
    .alias("new")
    .description("Create an issue, project, or initiative custom view")
    .option("--name <name>", "view name")
    .addOption(new Option("--type <type>", "entity type").choices([...svc.CUSTOM_VIEW_TYPES]))
    .option("--owner <who>", "owner (me|email|name|id)")
    .option("--color <hex>", "icon color")
    .option("--icon <icon>", "emoji or decorative icon identifier")
    .addOption(
      new Option("--scope-team <key|name|id>", "attach the view to a team").conflicts([
        "scopeProject",
        "scopeInitiative",
      ]),
    )
    .addOption(
      new Option("--scope-project <id|name>", "attach the view to a project").conflicts([
        "scopeTeam",
        "scopeInitiative",
      ]),
    )
    .addOption(
      new Option("--scope-initiative <id|name>", "attach the view to an initiative").conflicts([
        "scopeTeam",
        "scopeProject",
      ]),
    );
  create = addVisibilityOptions(addFilterOptions(addDescriptionOptions(create)));
  create
    .addHelpText(
      "after",
      `\nExamples:\n  linear custom-view create --name "Urgent" --type issue --filter '{"priority":{"eq":1}}' --shared\n  linear cv create --name "At risk" --type project --filter-file project-filter.json --scope-team ENG\n`,
    )
    .action(
      action(async (ctx: Context, opts) => {
        const name = opts.name ?? (await promptInput(ctx, "Name:", { required: true }));
        const type: svc.CustomViewType =
          opts.type ??
          (await promptSelect(ctx, "View type:", [
            { name: "Issues", value: "issue" as const },
            { name: "Projects", value: "project" as const },
            { name: "Initiatives", value: "initiative" as const },
          ]));
        const description = resolveBody({
          arg: opts.description,
          file: opts.descriptionFile,
          interactive: false,
        });
        const created = await svc.createCustomView(ctx.client, {
          name,
          type,
          filter: filterFrom(opts),
          description,
          color: opts.color,
          icon: opts.icon,
          owner: opts.owner,
          shared: visibility(opts),
          scopeTeam: opts.scopeTeam,
          scopeProject: opts.scopeProject,
          scopeInitiative: opts.scopeInitiative,
        });
        ctx.output.emit(receipt(created), () =>
          ctx.output.success(`Created custom view ${created.name} (${created.id})`),
        );
      }),
    );

  let update = customView
    .command("update <id>")
    .alias("edit")
    .description("Update mutable fields on a custom view UUID")
    .option("--name <name>", "new name")
    .option("--owner <who>", "new owner (me|email|name|id)")
    .addOption(new Option("--color <hex>", "new icon color").conflicts("clearColor"))
    .addOption(new Option("--clear-color", "clear the icon color").conflicts("color"))
    .addOption(new Option("--icon <icon>", "new icon").conflicts("clearIcon"))
    .addOption(new Option("--clear-icon", "clear the icon").conflicts("icon"))
    .addOption(
      new Option("--clear-description", "clear the description").conflicts([
        "description",
        "descriptionFile",
      ]),
    )
    .addOption(
      new Option("--scope-team <key|name|id>", "set the public team scope").conflicts(
        "clearTeamScope",
      ),
    )
    .addOption(
      new Option("--clear-team-scope", "clear the public team scope").conflicts("scopeTeam"),
    );
  update = addVisibilityOptions(addFilterOptions(addDescriptionOptions(update, true)));
  update.action(
    action(async (ctx: Context, opts, id: string) => {
      const description = resolveBody({
        arg: opts.description,
        file: opts.descriptionFile,
        interactive: false,
      });
      const changed = await svc.updateCustomView(ctx.client, id, {
        name: opts.name,
        filter: filterFrom(opts),
        description,
        clearDescription: opts.clearDescription,
        color: opts.color,
        clearColor: opts.clearColor,
        icon: opts.icon,
        clearIcon: opts.clearIcon,
        owner: opts.owner,
        shared: visibility(opts),
        scopeTeam: opts.scopeTeam,
        clearTeamScope: opts.clearTeamScope,
      });
      ctx.output.emit(receipt(changed), () =>
        ctx.output.success(`Updated custom view ${changed.name}`),
      );
    }),
  );

  customView
    .command("delete <id>")
    .alias("rm")
    .description("Delete a custom view by UUID")
    .action(
      action(async (ctx: Context, _opts, id: string) => {
        const detail = await svc.getCustomViewDetail(ctx.client, id);
        if (!(await confirmDestructive(ctx, `Delete custom view ${detail.name}?`))) return;
        const deleted = await svc.deleteCustomView(ctx.client, id);
        ctx.output.emit({ id: deleted.id, name: deleted.name, deleted: true }, () =>
          ctx.output.success(`Deleted custom view ${deleted.name}`),
        );
      }),
    );
}
