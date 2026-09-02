import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig, userConfigPath } from "../../src/config.js";
import { buildFilter as buildIssueFilter } from "../../src/services/issue.js";
import { buildFilter as buildProjectFilter } from "../../src/services/project.js";

const BIN = join(import.meta.dir, "..", "..", "src", "bin", "linear.ts");

let root: string;
let xdg: string;
let project: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lin-workspace-team-contract-"));
  xdg = join(root, "xdg");
  project = join(root, "project");
  mkdirSync(join(xdg, "linear"), { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(
    userConfigPath({ XDG_CONFIG_HOME: xdg, HOME: root }),
    `default_workspace = "org-a"\nteam = "LEGACY"\n` +
      `[workspaces.org-a]\napi_key = "lin_api_a_secret000"\nteam = "AAA"\n` +
      `[workspaces.org-b]\napi_key = "lin_api_b_secret000"\nteam = "BBB"\n`,
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(args: string[], extraEnv: NodeJS.ProcessEnv = {}, cwd = root) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, XDG_CONFIG_HOME: xdg };
  for (const key of [
    "LINEAR_API_KEY",
    "LINEAR_API_TOKEN",
    "LINEAR_ACCESS_TOKEN",
    "LINEAR_TEAM",
    "LINEAR_TEAM_ID",
    "LINEAR_WORKSPACE",
  ]) {
    delete env[key];
  }
  Object.assign(env, extraEnv);
  const result = spawnSync("bun", ["--no-env-file", BIN, ...args, "--json"], {
    cwd,
    env,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}

describe("per-workspace default-team CLI contract", () => {
  it("switches profile team and provenance with --workspace or LINEAR_WORKSPACE", () => {
    for (const shown of [
      run(["config", "show", "--workspace", "org-b"]),
      run(["config", "show"], { LINEAR_WORKSPACE: "org-b" }),
    ]) {
      expect(shown).toMatchObject({
        credentialWorkspace: "org-b",
        workspaceProfile: "org-b",
        team: "BBB",
        origins: {
          team: { source: "workspace-profile", key: "team", workspace: "org-b" },
        },
      });
      expect(JSON.stringify(shown)).not.toContain("secret000");
    }
  });

  it("keeps a repository team above the selected profile", () => {
    writeFileSync(join(project, ".linear.toml"), `workspace = "org-b"\nteam = "PROJECT"\n`);
    const shown = run(["config", "show"], {}, project);
    expect(shown).toMatchObject({
      credentialWorkspace: "org-b",
      workspaceProfile: "org-b",
      team: "PROJECT",
      origins: { team: { source: "project", key: "team" } },
    });
  });

  it("does not silently bind invocation credentials to the default or project profile", () => {
    writeFileSync(join(project, ".linear.toml"), `workspace = "org-b"\n`);
    const implicit = run(["config", "show", "--api-key", "lin_api_injected"], {}, project);
    expect(implicit).toMatchObject({
      credentialWorkspace: null,
      workspaceProfile: null,
      team: "LEGACY",
      origins: { team: { source: "user" } },
    });

    const explicit = run([
      "config",
      "show",
      "--access-token",
      "oauth_injected",
      "--workspace",
      "org-b",
    ]);
    expect(explicit).toMatchObject({
      credentialWorkspace: null,
      workspaceProfile: "org-b",
      team: "BBB",
      origins: { team: { source: "workspace-profile", workspace: "org-b" } },
    });
  });

  it("keeps --all-teams authoritative over a resolved profile default", async () => {
    const config = resolveConfig({
      cwd: root,
      env: { HOME: root, XDG_CONFIG_HOME: xdg },
      flags: { workspace: "org-b" },
    });
    expect(config.team).toBe("BBB");
    expect(await buildIssueFilter({} as any, { allTeams: true }, config.team)).toEqual({});
    expect(await buildProjectFilter({} as any, { allTeams: true }, config.team)).toEqual({});
  });
});
