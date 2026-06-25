/**
 * Top-level meta commands: whoami, auth (login/status/logout), config.
 */

import { Command } from "commander";
import { LinearClient } from "@linear/sdk";
import { action } from "../lib/action.js";
import { withRetry } from "../client.js";
import { writeApiKey, clearApiKey, redactKey, resolveConfig } from "../config.js";
import { authError } from "../lib/errors.js";
import { promptInput } from "../lib/prompt.js";
import type { Context } from "../context.js";

export function registerMeta(program: Command): void {
  program
    .command("whoami")
    .description("Show the authenticated user")
    .action(
      action(async (ctx) => {
        const me = await withRetry(() => ctx.client.viewer);
        const org = await withRetry(() => ctx.client.organization);
        ctx.output.detail(
          {
            id: me.id,
            name: me.name,
            displayName: me.displayName,
            email: me.email,
            admin: me.admin,
            organization: { id: org.id, name: org.name, urlKey: org.urlKey },
          },
          [
            ["Name", me.name],
            ["Display name", me.displayName],
            ["Email", me.email],
            ["Admin", me.admin],
            ["User ID", me.id],
            ["Organization", `${org.name} (${org.urlKey})`],
          ],
        );
      }),
    );

  const auth = program.command("auth").description("Manage authentication");

  auth
    .command("login")
    .description("Store a Linear API key in the user config")
    .option("--key <key>", "API key (otherwise prompted)")
    .action(
      action(async (ctx: Context, opts) => {
        let key: string | undefined = opts.key;
        if (!key) key = await promptInput(ctx, "Linear API key:", { required: true });
        key = key.trim();
        // Validate before persisting.
        const client = new LinearClient({ apiKey: key });
        let me;
        try {
          me = await client.viewer;
        } catch {
          throw authError("That API key was rejected by Linear.");
        }
        const path = writeApiKey(key);
        ctx.output.emit(
          { success: true, user: { id: me.id, name: me.name, email: me.email }, path },
          () => ctx.output.success(`Authenticated as ${me.name} <${me.email}>. Key saved to ${path}`),
        );
      }),
    );

  auth
    .command("status")
    .description("Show where the API key is resolved from (key redacted)")
    .action(
      action(async (ctx) => {
        const c = ctx.config;
        ctx.output.detail(
          { authenticated: !!c.apiKey, source: c.apiKeySource, key: redactKey(c.apiKey) },
          [
            ["Authenticated", !!c.apiKey],
            ["Source", c.apiKeySource],
            ["Key", redactKey(c.apiKey)],
          ],
        );
      }),
    );

  auth
    .command("logout")
    .description("Remove the stored API key from the user config")
    .action(
      action(async (ctx) => {
        const removed = clearApiKey();
        ctx.output.emit({ success: true, removed }, () =>
          removed
            ? ctx.output.success("Removed stored API key.")
            : ctx.output.info("No stored API key to remove."),
        );
      }),
    );

  program
    .command("config")
    .description("Show the resolved configuration (secrets redacted)")
    .action(
      action(async (ctx) => {
        // Re-resolve to expose sources/paths beyond what Context keeps.
        const c = resolveConfig({
          flags: { apiKey: ctx.options.apiKey, team: ctx.options.team },
        });
        ctx.output.detail(
          {
            apiKey: redactKey(c.apiKey),
            apiKeySource: c.apiKeySource,
            team: c.team ?? null,
            workspace: c.workspace ?? null,
            sort: c.sort,
            vcs: c.vcs,
            userConfigPath: c.userConfigPath,
            projectConfigPath: c.projectConfigPath ?? null,
          },
          [
            ["API key", `${redactKey(c.apiKey)} (${c.apiKeySource})`],
            ["Team", c.team],
            ["Workspace", c.workspace],
            ["Sort", c.sort],
            ["VCS", c.vcs],
            ["User config", c.userConfigPath],
            ["Project config", c.projectConfigPath],
          ],
        );
      }),
    );
}
