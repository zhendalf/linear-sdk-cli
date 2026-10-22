import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "..", "src", "bin", "linear.ts");
let root: string;
let folder: string;
let nested: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lin-folder-project-")));
  folder = join(root, "folder");
  nested = join(folder, "nested");
  mkdirSync(nested, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(args: string[], cwd = folder, extraEnv: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: root,
    XDG_CONFIG_HOME: join(root, "xdg"),
    NO_COLOR: "1",
    ...extraEnv,
  };
  return spawnSync("bun", ["--no-env-file", BIN, ...args], { cwd, env, encoding: "utf8" });
}

function json(args: string[], cwd = folder, extraEnv: NodeJS.ProcessEnv = {}) {
  const result = run([...args, "--json"], cwd, extraEnv);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}

describe("folder default project CLI contract", () => {
  it("binds a folder without credentials, preserves its settings, and applies in descendants only", () => {
    const path = join(folder, ".linear.toml");
    writeFileSync(path, '# keep this comment\nteam = "ENG"\nworkspace = "acme"\n');
    expect(json(["config", "set", "project", "My Project"])).toEqual({
      success: true,
      path,
      key: "project",
      value: "My Project",
    });
    expect(readFileSync(path, "utf8")).toContain(
      '# keep this comment\nteam = "ENG"\nworkspace = "acme"\n',
    );
    const shown = json(["config", "show"], nested);
    expect(shown).toMatchObject({
      team: "ENG",
      workspace: "acme",
      project: "My Project",
      origins: { project: { source: "project", path, key: "project" } },
    });
    expect(json(["config", "show"], root).project).toBeNull();
    const human = run(["config", "show"], nested);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain("My Project");
    expect(human.stdout).toContain(path);
  });

  it("supports a separate association for a nested folder via --path", () => {
    json(["config", "init", "--team", "ENG", "--project", "Parent"]);
    json(["config", "set", "project", "Child", "--path", ".linear.toml"], nested);
    expect(json(["config", "show"], nested).project).toBe("Child");
    expect(json(["config", "show"], folder).project).toBe("Parent");
    expect(json(["config", "show"], nested, { LINEAR_PROJECT: "Environment" }).project).toBe(
      "Environment",
    );
  });

  it("rejects blank projects without editing the file", () => {
    json(["config", "set", "project", "My Project"]);
    const path = join(folder, ".linear.toml");
    const before = readFileSync(path, "utf8");
    const result = run(["config", "set", "project", " ", "--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "usage" } });
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("advertises creation overrides and accurate config output shapes", () => {
    const help = run(["issue", "create", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--no-project");
    expect(help.stdout).toMatch(/configured\s+default/);
    const config = json(["commands", "config", "show"]);
    expect(config.output.fields.project).toBe("string|null");
    expect(config.output.fields.origins.project).toHaveProperty("source", "string");
    const init = json(["commands", "config", "init"]);
    expect(init.output.fields["project?"]).toBe("string");
  });
});
