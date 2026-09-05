/**
 * Top-level meta commands: whoami, auth (login/list/default/token/status/
 * logout/migrate), config.
 */

import { Command } from "commander";
import { LinearClient } from "@linear/sdk";
import { action } from "../lib/action.js";
import { withRetry } from "../client.js";
import { resolve } from "node:path";
import {
  writeCredential,
  probeKeyringCredential,
  adoptKeyringCredential,
  removeCredentialWithMetadata,
  removeOAuthCredential,
  setDefaultWorkspace,
  listCredentials,
  readOAuthCredential,
  writeOAuthCredential,
  migrateCredentials,
  redactKey,
  resolveConfig,
  defaultProjectConfigPath,
  assertSettableKey,
  setConfigKey,
  setWorkspaceTeam,
  initProjectConfig,
  SETTABLE_KEYS,
  type SettableKey,
} from "../config.js";
import { keyring } from "../lib/keyring.js";
import { readStdinSync } from "../lib/body.js";
import { CliError, authError, normalizeError, usageError } from "../lib/errors.js";
import { confirmDestructive, promptSelect } from "../lib/prompt.js";
import { listTeams } from "../services/team.js";
import { resolveTeam } from "../lib/resolve.js";
import { ISSUE_SORTS } from "../services/issue.js";
import { firstTeam, type Context } from "../context.js";
import { openUrl } from "../lib/open.js";
import {
  DEFAULT_OAUTH_SCOPES,
  buildAuthorizationUrl,
  createPkceRequest,
  exchangeAuthorizationCode,
  revokeOAuthToken,
  startLoopbackCallback,
  type OAuthUserCredential,
} from "../oauth.js";

export const DEFAULT_OAUTH_REDIRECT_URI = "http://127.0.0.1:43821/oauth/callback";
/** Public PKCE client identity. This is not a credential; no client secret is shipped or used. */
export const DEFAULT_OAUTH_CLIENT_ID = "eda60862e4bb8b8af82cfb3193b65c2f";

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

interface AuthIdentity {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; urlKey: string };
}

interface AuthValidationClient {
  viewer: Promise<{ id: string; name: string; email: string }>;
  organization: Promise<{ id: string; name: string; urlKey: string }>;
}

export type AuthValidationClientFactory = (
  credential: string,
  kind?: "api-key" | "oauth-access-token",
) => AuthValidationClient;

const defaultAuthValidationClientFactory: AuthValidationClientFactory = (credential, kind) =>
  new LinearClient(
    kind === "oauth-access-token" ? { accessToken: credential } : { apiKey: credential },
  ) as unknown as AuthValidationClient;
let authValidationClientFactory = defaultAuthValidationClientFactory;

/** Test seam for command-level auth tests; production always uses LinearClient. */
export function setAuthValidationClientFactoryForTests(
  factory: AuthValidationClientFactory | undefined,
): void {
  authValidationClientFactory = factory ?? defaultAuthValidationClientFactory;
}

type WorkspaceTeamValidator = (ctx: Context, workspace: string, team: string) => Promise<string>;

/** Validate that an effective credential and team both belong to the requested workspace. */
export const validateWorkspaceTeam: WorkspaceTeamValidator = async (ctx, workspace, team) => {
  const [organization, resolved] = await Promise.all([
    withRetry(() => ctx.client.organization),
    resolveTeam(ctx.client, team, undefined),
  ]);
  if (organization.urlKey !== workspace) {
    throw usageError(
      `--workspace '${workspace}' does not match the credential's workspace '${organization.urlKey}'.`,
    );
  }
  return resolved.key;
};

let workspaceTeamValidator = validateWorkspaceTeam;

/** Test seam for profile-team validation; production always checks Linear. */
export function setWorkspaceTeamValidatorForTests(
  validator: WorkspaceTeamValidator | undefined,
): void {
  workspaceTeamValidator = validator ?? validateWorkspaceTeam;
}

/** Merge the local and global login spellings without silently choosing one. */
export function selectLoginKey(
  localKey: string | undefined,
  globalKey: string | undefined,
): string | undefined {
  if (localKey !== undefined && globalKey !== undefined) {
    throw usageError("Pass only one of --key or --api-key to `auth login`.");
  }
  return localKey ?? globalKey;
}

/** Validate a credential and prove that an explicitly requested slug matches it. */
export async function validateAuthCredential(
  credential: string,
  requestedWorkspace?: string,
  kind: "api-key" | "oauth-access-token" = "api-key",
): Promise<AuthIdentity> {
  const client = authValidationClientFactory(credential, kind);
  let me;
  let org;
  try {
    me = await withRetry(() => client.viewer);
    org = await withRetry(() => client.organization);
  } catch (err) {
    const normalized = normalizeError(err);
    if (normalized.code === "auth" || normalized.code === "forbidden") {
      throw authError(
        kind === "api-key"
          ? "That API key was rejected by Linear."
          : "Linear rejected the OAuth access token.",
      );
    }
    throw normalized;
  }
  if (requestedWorkspace && requestedWorkspace !== org.urlKey) {
    throw usageError(
      `--workspace '${requestedWorkspace}' does not match the credential's workspace '${org.urlKey}'. Store credentials under their Linear workspace slug.`,
    );
  }
  return {
    user: { id: me.id, name: me.name, email: me.email },
    organization: { id: org.id, name: org.name, urlKey: org.urlKey },
  };
}

/** Bind a completed login using the same project location rules as `config set`. */
function saveLoginProject(ctx: Context, workspace: string, project: boolean): string | null {
  if (!project) return null;
  const path = ctx.config.projectConfigPath ?? defaultProjectConfigPath();
  try {
    setConfigKey(path, "workspace", workspace);
  } catch {
    throw new CliError(
      `Credentials saved for workspace '${workspace}', but its project association could not be saved to ${path}. Fix the project file and run \`linear config set workspace ${workspace}\`; login does not need to be repeated.`,
      "runtime",
    );
  }
  return path;
}

function explicitWorkspaceSlug(input: string): string {
  const slug = input.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(slug)) {
    throw usageError(
      "Workspace slug must be its lowercase Linear URL key (letters, numbers, and hyphens).",
    );
  }
  return slug;
}

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
    .description("Authenticate and select the workspace for this project")
    .option("--no-project", "save credentials without changing the project workspace")
    .option("--key <key>", "use a personal API key ('-' reads it from stdin)")
    .option("--plaintext", "Store the key in the config file (0600) instead of the system keyring")
    .option("--no-browser", "print the authorization URL instead of opening it")
    .option("--read-only", "request read-only OAuth access")
    .option("--admin", "explicitly add the OAuth admin scope")
    .option("--timeout <seconds>", "seconds to wait for the loopback callback", "120")
    .option("--client-id <id>", "OAuth client ID (defaults to the packaged CLI app)")
    .option("--redirect-uri <uri>", "registered HTTP loopback callback URI")
    .action(
      action(async (ctx: Context, opts) => {
        if (ctx.options.accessToken !== undefined) {
          throw usageError(
            "`auth login` cannot persist an injected access token. Remove --access-token and use browser OAuth, or use --key - for a personal API key.",
          );
        }
        let key: string | undefined = selectLoginKey(opts.key, ctx.options.apiKey);
        if (key !== undefined) {
          if (
            opts.readOnly ||
            opts.admin ||
            opts.browser === false ||
            opts.redirectUri ||
            opts.clientId
          ) {
            throw usageError("OAuth-only options cannot be combined with --key or --api-key.");
          }
          if (key === "-") key = readStdinSync();
          else
            ctx.output.warn(
              "An API key on the command line is visible to other processes and shell history; prefer --key - (stdin).",
            );
          key = key.trim();
          if (!key) throw usageError("No API key provided.");
          const identity = await validateAuthCredential(key, ctx.options.workspace);
          const { user: me, organization: org } = identity;
          const { path, storage, keyringLabel } = writeCredential(org.urlKey, key, {
            plaintext: opts.plaintext === true,
          });
          const projectConfigPath = saveLoginProject(ctx, org.urlKey, opts.project !== false);
          const where =
            storage === "keychain"
              ? `Credential saved to the ${keyringLabel}; ${path} records the workspace.`
              : `Credential saved to ${path} (plaintext, 0600).`;
          ctx.output.emit(
            {
              success: true,
              credentialType: "api-key",
              workspace: org.urlKey,
              user: me,
              storage,
              path,
              projectConfigPath,
            },
            () =>
              ctx.output.success(
                `Authenticated as ${me.name} <${me.email}> for workspace '${org.urlKey}'. ${where}${projectConfigPath ? ` Project workspace saved to ${projectConfigPath}.` : ""}`,
              ),
          );
          return;
        }

        if (opts.plaintext) {
          throw usageError(
            "OAuth credentials are keyring-only; --plaintext requires --key or --api-key.",
          );
        }
        if (opts.readOnly && opts.admin) {
          throw usageError("--read-only cannot be combined with --admin.");
        }
        const timeoutSeconds = Number(opts.timeout);
        if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
          throw usageError("--timeout must be a positive number of seconds.");
        }
        const clientId = String(
          opts.clientId ?? process.env.LINEAR_OAUTH_CLIENT_ID ?? DEFAULT_OAUTH_CLIENT_ID,
        ).trim();
        const redirectUri = String(
          opts.redirectUri ?? process.env.LINEAR_OAUTH_REDIRECT_URI ?? DEFAULT_OAUTH_REDIRECT_URI,
        );
        const scopes = opts.readOnly
          ? ["read"]
          : opts.admin
            ? [...DEFAULT_OAUTH_SCOPES, "admin"]
            : [...DEFAULT_OAUTH_SCOPES];
        const pkce = createPkceRequest();
        const callback = await startLoopbackCallback({
          redirectUri,
          state: pkce.state,
          timeoutMs: timeoutSeconds * 1000,
        });
        try {
          const authorizationUrl = buildAuthorizationUrl({
            clientId,
            redirectUri: callback.redirectUri,
            scopes,
            challenge: pkce.challenge,
            state: pkce.state,
          });
          if (opts.browser === false) {
            ctx.output.info(`Open this URL to authenticate with Linear:\n${authorizationUrl}`);
          } else {
            ctx.output.info("Opening Linear in your browser…");
            await openUrl(authorizationUrl);
          }
          const code = await callback.wait;
          const token = await exchangeAuthorizationCode({
            code,
            verifier: pkce.verifier,
            clientId,
            redirectUri: callback.redirectUri,
          });
          const identity = await validateAuthCredential(
            token.accessToken,
            ctx.options.workspace,
            "oauth-access-token",
          );
          const credential: OAuthUserCredential = {
            version: 1,
            kind: "oauth-user",
            actor: "user",
            ...token,
            clientId,
            workspace: identity.organization,
            user: identity.user,
          };
          const saved = writeOAuthCredential(credential);
          const projectConfigPath = saveLoginProject(
            ctx,
            credential.workspace.urlKey,
            opts.project !== false,
          );
          ctx.output.emit(
            {
              success: true,
              credentialType: "oauth-user",
              workspace: credential.workspace.urlKey,
              user: credential.user,
              storage: saved.storage,
              scopes: credential.scopes,
              expiresAt: new Date(credential.expiresAt).toISOString(),
              path: saved.path,
              projectConfigPath,
            },
            () =>
              ctx.output.success(
                `Authenticated as ${credential.user.name} <${credential.user.email}> for workspace '${credential.workspace.urlKey}'. OAuth credentials saved to the ${saved.keyringLabel}.${projectConfigPath ? ` Project workspace saved to ${projectConfigPath}.` : ""}`,
              ),
          );
        } finally {
          await callback.close();
        }
      }),
    );

  // adopt ------------------------------------------------------------------
  auth
    .command("adopt <slug>")
    .description("Adopt an existing named credential from the shared OS keyring")
    .action(
      action(async (ctx: Context, _opts, input: string) => {
        const slug = explicitWorkspaceSlug(input);
        if (ctx.options.apiKey !== undefined) {
          throw usageError(
            "`auth adopt` reads only the named OS keyring entry; remove --api-key (or use `auth login --key -` to supply a key on stdin).",
          );
        }
        if (ctx.options.workspace && ctx.options.workspace !== slug) {
          throw usageError(
            `The positional workspace '${slug}' conflicts with --workspace '${ctx.options.workspace}'.`,
          );
        }

        // Probe one exact account only. No keyring enumeration and no secret
        // on argv, stdout, stderr, or disk.
        const found = probeKeyringCredential(slug);
        const identity = await validateAuthCredential(found.apiKey, slug);
        const adopted = adoptKeyringCredential(slug, found.apiKey);
        ctx.output.emit(
          {
            success: true,
            workspace: slug,
            user: identity.user,
            storage: adopted.storage,
            path: adopted.path,
          },
          () =>
            ctx.output.success(
              `Adopted workspace '${slug}' from the ${adopted.keyringLabel}; ${adopted.path} now records the workspace without storing the secret.`,
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
            { key: "credentialType", header: "Type", value: (e) => e.credentialType },
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
        if (c.accessToken) {
          throw usageError(
            "`auth token` exports stored API keys only. OAuth access tokens are never exported; use the authenticated command directly.",
          );
        }
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
    .description("Show where the active credential is resolved from (value redacted)")
    .action(
      action(async (ctx) => {
        const c = ctx.config;
        if (c.workspaceChoices) throw c.apiKeyError;
        const credential = c.accessToken ?? c.apiKey;
        const credentialType = c.oauthCredential
          ? "oauth-user"
          : c.accessToken
            ? "oauth-access-token"
            : c.apiKey
              ? "api-key"
              : null;
        const source = c.accessToken ? c.accessTokenSource : c.apiKeySource;
        const backend = keyring();
        ctx.output.detail(
          {
            authenticated: !!credential,
            credentialType,
            source,
            workspace: c.credentialWorkspace ?? null,
            key: redactKey(credential),
            keyring: backend?.name ?? null,
            scopes: c.oauthCredential?.scopes ?? null,
            expiresAt: c.oauthCredential
              ? new Date(c.oauthCredential.expiresAt).toISOString()
              : null,
          },
          [
            ["Authenticated", !!credential],
            ["Credential type", credentialType ?? "(none)"],
            ["Source", source],
            ["Workspace", c.credentialWorkspace ?? "(none)"],
            ["Credential", redactKey(credential)],
            ["Keyring", backend ? backend.label : "(none on this platform)"],
            ["Scopes", c.oauthCredential?.scopes.join(", ")],
            [
              "Expires",
              c.oauthCredential ? new Date(c.oauthCredential.expiresAt).toISOString() : undefined,
            ],
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
    .option("--local-only", "remove local credentials without OAuth revocation")
    .action(
      // Targets the global `--workspace <slug>`. When omitted, the sole
      // configured workspace is used; if several exist, this errors.
      action(async (ctx: Context, opts) => {
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
        if (!(await confirmDestructive(ctx, `Remove credential for workspace '${slug}'?`))) return;
        const entry = listCredentials().find((candidate) => candidate.slug === slug);
        let revocation: "revoked" | "already-revoked" | "skipped" = "skipped";
        if (entry?.credentialType === "oauth-user" && opts.localOnly !== true) {
          const oauth = readOAuthCredential(slug);
          if (oauth) {
            revocation = await revokeOAuthToken({
              token: oauth.refreshToken,
              tokenTypeHint: "refresh_token",
            });
          }
        }
        const local =
          entry?.credentialType === "oauth-user"
            ? removeOAuthCredential(slug)
            : { ...removeCredentialWithMetadata(slug), fallbackCredentialType: null };
        ctx.output.emit(
          {
            success: true,
            workspace: slug,
            removed: local.removed,
            revocation,
            fallbackCredentialType: local.fallbackCredentialType,
            teamMetadataRemoved: local.teamMetadataRemoved,
          },
          () =>
            local.removed
              ? ctx.output.success(
                  `Removed workspace '${slug}'.${revocation === "revoked" ? " OAuth access was revoked." : revocation === "already-revoked" ? " OAuth access was already revoked." : ""}${local.fallbackCredentialType ? " The existing personal API-key profile is active again." : ""}${local.teamMetadataRemoved ? " Its default team metadata was removed." : ""}`,
                )
              : ctx.output.info(`No credential for workspace '${slug}' to remove.`),
        );
      }),
    );

  const config = program
    .command("config")
    .description("Show the resolved configuration, or write a project config");

  // show (default) ----------------------------------------------------------
  config
    .command("show", { isDefault: true })
    .description(
      "Show the resolved configuration and where each value came from (secrets redacted)",
    )
    .action(
      action(async (ctx) => {
        // Re-resolve to expose sources/paths beyond what Context keeps.
        const c = resolveConfig({
          flags: {
            apiKey: ctx.options.apiKey,
            accessToken: ctx.options.accessToken,
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
        const show = (
          key: keyof typeof c.origins,
          value: string | undefined,
        ): string | undefined => (value === undefined ? undefined : `${value}  (${from(key)})`);
        ctx.output.detail(
          {
            apiKey: redactKey(c.apiKey),
            apiKeySource: c.apiKeySource,
            accessToken: redactKey(c.accessToken),
            accessTokenSource: c.accessTokenSource,
            credentialWorkspace: c.credentialWorkspace ?? null,
            workspaceProfile: c.workspaceProfile ?? null,
            team: c.team ?? null,
            workspace: c.workspace ?? null,
            sort: c.sort,
            origins: c.origins,
            userConfigPath: c.userConfigPath,
            projectConfigPath: c.projectConfigPath ?? null,
            globalConfigPath: c.globalConfigPath ?? null,
          },
          [
            ["API key", `${redactKey(c.apiKey)} (${c.apiKeySource})`],
            ["OAuth access token", `${redactKey(c.accessToken)} (${c.accessTokenSource})`],
            ["Credential workspace", c.credentialWorkspace ?? "(none)"],
            ["Workspace profile", c.workspaceProfile ?? "(none)"],
            ["Team", show("team", c.team)],
            ["Workspace", show("workspace", c.workspace)],
            ["Sort", show("sort", c.sort)],
            ["User config", c.userConfigPath],
            ["Project config", c.projectConfigPath],
            ["Global config", c.globalConfigPath],
          ],
        );
      }),
    );

  // init --------------------------------------------------------------------
  config
    .command("init")
    .description("Write a project .linear.toml (at the git root, or here outside a repository)")
    .option("--team <key>", "default team key (otherwise chosen from a list)")
    .option("--sort <order>", `default issue-list sort (${ISSUE_SORTS.join(" | ")})`)
    .option("--path <file>", "write this file instead of <git root>/.linear.toml")
    .option("--force", "overwrite an existing file")
    .action(
      action(async (ctx: Context, opts) => {
        const path = opts.path ? resolve(opts.path) : defaultProjectConfigPath();
        // Team is the one setting that matters; without --team, offer the real
        // list (a prompt, so it needs a terminal — scripts pass the flag).
        let team: string | undefined = opts.team ?? firstTeam(ctx.options.team);
        if (!team) {
          if (!ctx.isTTY) {
            throw usageError("Pass --team <key>; there is no terminal to choose one from.");
          }
          await ctx.selectWorkspace();
          const teams = await listTeams(ctx.client, Infinity);
          if (teams.length === 0) throw usageError("This workspace has no teams to choose from.");
          team = await promptSelect(
            ctx,
            "Default team for this repository:",
            teams
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((t) => ({ name: `${t.name} (${t.key})`, value: t.key })),
          );
        }
        const settings: Partial<Record<SettableKey, string>> = {
          team: validateSetting("team", team),
        };
        if (opts.sort !== undefined) settings.sort = validateSetting("sort", opts.sort);
        initProjectConfig(path, settings, { force: opts.force === true });
        ctx.output.emit({ success: true, path, ...settings }, () =>
          ctx.output.success(
            `Wrote ${path} (team ${settings.team}${settings.sort ? `, sort ${settings.sort}` : ""}).`,
          ),
        );
      }),
    );

  // set ---------------------------------------------------------------------
  config
    .command("set <key> <value>")
    .description(`Set one project or user setting (${SETTABLE_KEYS.join(", ")})`)
    .option("--user", "write the user config (team + --workspace targets that workspace profile)")
    .option("--path <file>", "write this file instead of the project config in effect")
    .action(
      action(async (ctx: Context, opts, key: string, value: string) => {
        assertSettableKey(key);
        const clean = validateSetting(key, value);
        let path: string;
        let mode: number | undefined;
        if (opts.user && opts.path) throw usageError("Pass --user or --path, not both.");
        if (opts.user) {
          path = ctx.config.userConfigPath;
          mode = 0o600; // it holds credentials
        } else if (opts.path) {
          path = resolve(opts.path);
        } else {
          // The file discovery would read — so the change is visible from
          // here — or a fresh .linear.toml at the git root if there is none.
          path = ctx.config.projectConfigPath ?? defaultProjectConfigPath();
        }
        const profileWorkspace = opts.user && key === "team" ? ctx.options.workspace : undefined;
        if (profileWorkspace) {
          let team = clean;
          if (ctx.config.apiKey || ctx.config.accessToken) {
            team = await workspaceTeamValidator(ctx, profileWorkspace, clean);
          }
          path = setWorkspaceTeam(profileWorkspace, team);
          ctx.output.emit(
            { success: true, path, key: "team", value: team, workspace: profileWorkspace },
            () =>
              ctx.output.success(
                `Set team = ${JSON.stringify(team)} for workspace '${profileWorkspace}' in ${path}`,
              ),
          );
        } else {
          const spelling = setConfigKey(path, key, clean, { mode });
          ctx.output.emit({ success: true, path, key: spelling, value: clean }, () =>
            ctx.output.success(`Set ${spelling} = ${JSON.stringify(clean)} in ${path}`),
          );
        }
      }),
    );
}

/**
 * Check a value for a project setting the way the reader will judge it, so a
 * bad value is refused here rather than on the next `issue list`.
 */
function validateSetting(key: SettableKey, value: string): string {
  const v = value.trim();
  if (!v) throw usageError(`A value for '${key}' is required.`);
  switch (key) {
    case "sort":
      if (!(ISSUE_SORTS as readonly string[]).includes(v)) {
        throw usageError(`Invalid sort '${v}'. Valid values: ${ISSUE_SORTS.join(", ")}.`);
      }
      return v;
    case "team":
      // A team key: letters and digits, as Linear issues them (TES, ENG2).
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(v)) {
        throw usageError(`'${v}' does not look like a team key (letters and digits, e.g. TES).`);
      }
      return v.toUpperCase();
    default:
      return v;
  }
}
