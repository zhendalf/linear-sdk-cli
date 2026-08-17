/**
 * Top-level meta commands: whoami, auth (login/list/default/token/status/
 * logout/migrate), config.
 */

import { Command } from "commander";
import { LinearClient } from "@linear/sdk";
import { action } from "../lib/action.js";
import { withRetry } from "../client.js";
import {
  writeCredential,
  removeCredential,
  setDefaultWorkspace,
  listCredentials,
  migrateCredentials,
  redactKey,
  resolveConfig,
} from "../config.js";
import { keyring } from "../lib/keyring.js";
import { readStdinSync } from "../lib/body.js";
import { authError, usageError } from "../lib/errors.js";
import { promptSecret } from "../lib/prompt.js";
import { firstTeam, type Context } from "../context.js";

/**
 * The `whoami` handler, shared by the top-level `linear whoami` and the
 * reference CLI's spelling `linear auth whoami` so the two cannot drift.
 */
const whoamiAction = action(async (ctx: Context) => {
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
});

export function registerMeta(program: Command): void {
  program.command("whoami").description("Show the authenticated user").action(whoamiAction);

  const auth = program.command("auth").description("Manage authentication");

  // whoami ------------------------------------------------------------------
  // The reference CLI nests this under `auth`; ours is top-level. Both spellings
  // run the identical handler. (Note it is NOT an alias of `auth status`, which
  // reports where the *key* came from and never names the user — the reference's
  // `auth whoami` prints user + workspace, exactly like our top-level `whoami`.)
  auth.command("whoami").description("Show the authenticated user").action(whoamiAction);

  // login -------------------------------------------------------------------
  auth
    .command("login")
    .description("Validate and store a Linear API key for a workspace")
    .option("--key <key>", "API key (otherwise prompted; '-' reads it from stdin)")
    .option(
      "--plaintext",
      "Store the key in the config file (0600) instead of the system keyring",
    )
    .action(
      // The global `--workspace <slug>` selects the slug to store under
      // (default: derived from the key's organization urlKey).
      action(async (ctx: Context, opts) => {
        // `--key` still works for scripts. When prompted, the key is masked —
        // it is a credential, and it must not reach the screen or scrollback.
        // Nothing below echoes it either: the receipt reports the user and
        // where the key went, never the value.
        let key: string | undefined = opts.key;
        if (key === "-") {
          key = readStdinSync();
        } else if (key) {
          // argv is world-readable (`ps`) and lands in shell history; say so
          // once, quietly, and carry on — the script author chose it.
          ctx.output.warn(
            "--key on the command line is visible to other processes and shell history; prefer the prompt or `--key -` (stdin).",
          );
        } else {
          key = await promptSecret(ctx, "Linear API key:", { required: true });
        }
        key = key.trim();
        if (!key) throw usageError("No API key provided.");
        // Validate before persisting and learn the workspace slug.
        const client = new LinearClient({ apiKey: key });
        let me;
        let org;
        try {
          me = await client.viewer;
          org = await client.organization;
        } catch {
          throw authError("That API key was rejected by Linear.");
        }
        const slug: string = ctx.options.workspace ?? org.urlKey;
        const { path, storage, keyringLabel } = writeCredential(slug, key, {
          plaintext: opts.plaintext === true,
        });
        const where =
          storage === "keychain"
            ? `Key saved to the ${keyringLabel} (service linear-cli, account '${slug}'); ${path} records the workspace.`
            : opts.plaintext
              ? `Key saved to ${path} (plaintext, 0600).`
              : `Key saved to ${path} (plaintext, 0600 — no system keyring on this platform).`;
        ctx.output.emit(
          {
            success: true,
            workspace: slug,
            user: { id: me.id, name: me.name, email: me.email },
            storage,
            path,
          },
          () =>
            ctx.output.success(
              `Authenticated as ${me.name} <${me.email}> for workspace '${slug}'. ${where}`,
            ),
        );
      }),
    );

  // list --------------------------------------------------------------------
  auth
    .command("list")
    .alias("ls")
    .description("List configured workspace credentials")
    .action(
      action(async (ctx: Context) => {
        const entries = listCredentials();
        ctx.output.list(
          entries,
          [
            { key: "slug", header: "Workspace", value: (e) => e.slug },
            { key: "isDefault", header: "Default", value: (e) => (e.isDefault ? "yes" : "") },
            { key: "storage", header: "Storage", value: (e) => e.storage },
          ],
          entries,
        );
      }),
    );

  // default -----------------------------------------------------------------
  auth
    .command("default <slug>")
    .description("Set the default workspace credential")
    .action(
      action(async (ctx: Context, _opts, slug: string) => {
        const path = setDefaultWorkspace(slug);
        ctx.output.emit({ success: true, default_workspace: slug, path }, () =>
          ctx.output.success(`Default workspace set to '${slug}'.`),
        );
      }),
    );

  // token -------------------------------------------------------------------
  auth
    .command("token")
    .description("Print the resolved API key for the active workspace (for scripting)")
    .action(
      action(async (ctx: Context) => {
        const c = ctx.config;
        if (!c.apiKey) {
          // Surface the precise selection error (ambiguous / unstored slug) if any.
          throw (
            c.apiKeyError ??
            authError("No API key resolved. Run `linear auth login` or pass --workspace/--api-key.")
          );
        }
        // This command intentionally prints the secret — that is its purpose.
        ctx.output.emit({ apiKey: c.apiKey, workspace: c.credentialWorkspace ?? null }, () =>
          process.stdout.write(c.apiKey + "\n"),
        );
      }),
    );

  // status ------------------------------------------------------------------
  auth
    .command("status")
    .description("Show where the API key is resolved from (key redacted)")
    .action(
      action(async (ctx) => {
        const c = ctx.config;
        const backend = keyring();
        ctx.output.detail(
          {
            authenticated: !!c.apiKey,
            source: c.apiKeySource,
            workspace: c.credentialWorkspace ?? null,
            key: redactKey(c.apiKey),
            keyring: backend?.name ?? null,
          },
          [
            ["Authenticated", !!c.apiKey],
            ["Source", c.apiKeySource],
            ["Workspace", c.credentialWorkspace ?? "(none)"],
            ["Key", redactKey(c.apiKey)],
            ["Keyring", backend ? backend.label : "(none on this platform)"],
          ],
        );
        // A plaintext key on a machine that has a keyring is worth one nudge
        // (a human one — the JSON already carries `source` and `keyring`).
        if (c.apiKeySource === "user" && backend && !ctx.output.json) {
          ctx.output.info(`Run \`linear auth migrate\` to move it into the ${backend.label}.`);
        }
      }),
    );

  // migrate -----------------------------------------------------------------
  auth
    .command("migrate")
    .description("Move plaintext credentials from the config file into the system keyring")
    .action(
      action(async (ctx: Context) => {
        const { migrated, path, keyringLabel } = migrateCredentials();
        ctx.output.emit({ success: true, migrated, path }, () => {
          if (migrated.length === 0) {
            ctx.output.info(`Nothing to migrate: no plaintext keys in ${path}.`);
          } else {
            ctx.output.success(
              `Moved ${migrated.length} credential${migrated.length === 1 ? "" : "s"} into the ${keyringLabel}: ${migrated.join(", ")}. ${path} now holds only the workspace list.`,
            );
          }
        });
      }),
    );

  // logout ------------------------------------------------------------------
  auth
    .command("logout")
    .description("Remove a stored workspace credential (select with --workspace <slug>)")
    .action(
      // Targets the global `--workspace <slug>`. When omitted, the sole
      // configured workspace is used; if several exist, this errors.
      action(async (ctx: Context) => {
        let slug: string | undefined = ctx.options.workspace;
        if (!slug) {
          const configured = listCredentials();
          if (configured.length === 1) slug = configured[0]!.slug;
          else if (configured.length === 0)
            throw usageError("No workspace credentials are configured.");
          else
            throw usageError(
              `Multiple workspaces are configured (${configured
                .map((e) => e.slug)
                .join(", ")}). Pass --workspace <slug> to choose which to remove.`,
            );
        }
        const removed = removeCredential(slug);
        ctx.output.emit({ success: true, workspace: slug, removed }, () =>
          removed
            ? ctx.output.success(`Removed workspace '${slug}'.`)
            : ctx.output.info(`No credential for workspace '${slug}' to remove.`),
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
          flags: {
            apiKey: ctx.options.apiKey,
            // Still the *flag* value (so `teamSource` stays honest), just
            // narrowed: `--team` is repeatable on the issue queries.
            team: firstTeam(ctx.options.team),
            workspace: ctx.options.workspace,
          },
        });
        // Each setting names the tier it came from — and the file, when it was
        // one — so "why is my team X" has a one-line answer.
        const from = (key: keyof typeof c.origins): string => {
          const o = c.origins[key];
          if (o.source === "none") return "default";
          return o.path ? `${o.source}: ${o.path}` : o.source;
        };
        const show = (key: keyof typeof c.origins, value: string | undefined): string | undefined =>
          value === undefined ? undefined : `${value}  (${from(key)})`;
        ctx.output.detail(
          {
            apiKey: redactKey(c.apiKey),
            apiKeySource: c.apiKeySource,
            credentialWorkspace: c.credentialWorkspace ?? null,
            team: c.team ?? null,
            workspace: c.workspace ?? null,
            sort: c.sort,
            vcs: c.vcs,
            origins: c.origins,
            userConfigPath: c.userConfigPath,
            projectConfigPath: c.projectConfigPath ?? null,
            globalConfigPath: c.globalConfigPath ?? null,
          },
          [
            ["API key", `${redactKey(c.apiKey)} (${c.apiKeySource})`],
            ["Credential workspace", c.credentialWorkspace ?? "(none)"],
            ["Team", show("team", c.team)],
            ["Workspace", show("workspace", c.workspace)],
            ["Sort", show("sort", c.sort)],
            ["VCS", show("vcs", c.vcs)],
            ["User config", c.userConfigPath],
            ["Project config", c.projectConfigPath],
            ["Global config", c.globalConfigPath],
          ],
        );
      }),
    );
}
