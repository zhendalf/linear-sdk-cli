/** `linear open` — open a workspace, team, project, issue, or explicit URL. */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { usageError } from "../lib/errors.js";
import { openUrl } from "../lib/open.js";
import { normalizeIssueReference, resolveProjectId, resolveTeam } from "../lib/resolve.js";
import type { Context } from "../context.js";
import { getIssueDetail } from "../services/issue.js";
import { getOrganizationDetail } from "../services/organization.js";
import { getProjectDetail } from "../services/project.js";

const ISSUE_REFERENCE = /^[a-zA-Z][a-zA-Z0-9]*-\d+$/;
const URL = /^https?:\/\//i;
type OpenTarget = "workspace" | "team" | "project" | "issue" | "url";

export function registerOpen(program: Command): void {
  program
    .command("open [target]")
    .description("Open the workspace, an issue, team, project, or URL")
    .option("--app", "open in Linear.app (macOS)")
    .option("-w, --web", "open in the default browser (the default)")
    .addHelpText(
      "after",
      [
        "",
        "Targets: an issue id (TES-123), `team:<key>`, `project:<name>`, or an https URL.",
        "With no target, opens the current workspace. A bare team key opens that team.",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts, target?: string) => {
        if (opts.app && opts.web) throw usageError("Pass either --web or --app, not both.");
        const resolved = await resolveOpenTarget(ctx, target);
        await openUrl(resolved.url, { app: opts.app === true });
        ctx.output.emit({ ...resolved, opened: true }, () =>
          ctx.output.success(
            `Opened ${resolved.label} in ${opts.app ? "Linear.app" : "the browser"}`,
          ),
        );
      }),
    );
}

async function resolveOpenTarget(
  ctx: Context,
  target: string | undefined,
): Promise<{ target: OpenTarget; url: string; label: string }> {
  if (!target) {
    const org = await getOrganizationDetail(ctx.client);
    return { target: "workspace", url: `https://linear.app/${org.urlKey}`, label: org.name };
  }
  if (URL.test(target)) return { target: "url", url: target, label: target };
  if (target.startsWith("team:")) {
    const team = await resolveTeam(ctx.client, target.slice("team:".length), ctx.defaultTeam);
    const org = await getOrganizationDetail(ctx.client);
    return {
      target: "team",
      url: `https://linear.app/${org.urlKey}/team/${team.key}/all`,
      label: `${team.key} (${team.name})`,
    };
  }
  if (target.startsWith("project:")) {
    const project = await getProjectDetail(
      ctx.client,
      await resolveProjectId(ctx.client, target.slice("project:".length)),
    );
    return { target: "project", url: project.url, label: project.name };
  }
  const issueReference = /^\d+$/.test(target)
    ? normalizeIssueReference(target, ctx.defaultTeam)
    : target;
  if (ISSUE_REFERENCE.test(issueReference)) {
    const issue = await getIssueDetail(ctx.client, issueReference, { includeComments: false });
    return { target: "issue", url: issue.url, label: issue.identifier };
  }
  const team = await resolveTeam(ctx.client, target, ctx.defaultTeam);
  const org = await getOrganizationDetail(ctx.client);
  return {
    target: "team",
    url: `https://linear.app/${org.urlKey}/team/${team.key}/all`,
    label: `${team.key} (${team.name})`,
  };
}
