import { afterAll, beforeAll, describe, expect, it, vi } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { walkCommands } from "../../src/lib/introspect.js";
import { fakeRawRequest } from "../unit/_omni.js";

const ID = "11111111-1111-1111-1111-111111111111";
const SHA = "a".repeat(40);
let client: any;
let descriptor: PropertyDescriptor | undefined;
let savedKey: string | undefined;
const dir = mkdtempSync(join(tmpdir(), "linear-release-cli-"));

beforeAll(() => {
  savedKey = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = "lin_api_test000000000000";
  descriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
  Object.defineProperty(Context.prototype, "client", { configurable: true, get: () => client });
});
afterAll(() => {
  if (descriptor) Object.defineProperty(Context.prototype, "client", descriptor);
  if (savedKey === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = savedKey;
  rmSync(dir, { recursive: true, force: true });
});
async function run(args: string[]) {
  let stdout = "";
  let stderr = "";
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdout += chunk;
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    stderr += chunk;
    return true;
  });
  try {
    await createProgram().parseAsync(["node", "linear", ...args]);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return { stdout, stderr };
}
function useClient() {
  client = {
    client: {
      rawRequest: vi.fn(async (q: string) => {
        const r = await fakeRawRequest(q);
        if (q.includes("query CliReleasePipeline("))
          (r.data.releasePipeline as any).type = "scheduled";
        return r;
      }),
    },
  };
}
function mutationInput(name: string) {
  return client.client.rawRequest.mock.calls.find(([q]: [string]) =>
    q.includes(`mutation Cli${name}`),
  )[1].input;
}

describe("native Releases CLI contract", () => {
  it("exposes four documented groups and accurate global applicability", () => {
    const nodes = walkCommands(createProgram());
    for (const group of ["release", "release-pipeline", "release-stage", "release-note"]) {
      expect(nodes.some((n) => n.path === group)).toBe(true);
      expect(nodes.find((n) => n.path === `${group} list`)?.output?.kind).toBe("list");
      expect(nodes.find((n) => n.path === `${group} view`)?.output?.kind).toBe("object");
    }
    const sync = nodes.find((n) => n.path === "release sync")!;
    expect(
      sync.options.find((o) => o.flags === "--release-version <version>")?.description,
    ).toContain("no latest fallback");
    expect(sync.options.find((o) => o.attribute === "limit")?.applicable).toBe(false);
    expect(
      nodes.find((n) => n.path === "release list")!.options.find((o) => o.attribute === "all")
        ?.applicable,
    ).toBe(true);
    expect(
      nodes
        .find((n) => n.path === "release remove-issue")!
        .options.find((o) => o.attribute === "yes")?.applicable,
    ).toBe(true);
  });
  it("emits a bare JSON list and keeps pagination diagnostics on stderr", async () => {
    useClient();
    client.client.rawRequest.mockImplementation(async () => ({
      data: {
        releases: {
          nodes: [{ id: ID, name: "Release", version: "1.2" }],
          pageInfo: { hasNextPage: true, endCursor: "next" },
        },
      },
    }));
    const { stdout, stderr } = await run([
      "release",
      "list",
      "--limit",
      "1",
      "--fields",
      "id,name,version",
      "--json",
    ]);
    expect(JSON.parse(stdout)).toEqual([{ id: ID, name: "Release", version: "1.2" }]);
    expect(stderr).toContain("Showing 1 results; more exist");
  });
  it("returns [] for empty workspace pipeline/note lists", async () => {
    for (const [group, field] of [
      ["release-pipeline", "releasePipelines"],
      ["release-note", "releaseNotes"],
    ]) {
      useClient();
      client.client.rawRequest.mockResolvedValue({
        data: { [field!]: { nodes: [], pageInfo: { hasNextPage: false } } },
      });
      const { stdout, stderr } = await run([group!, "list", "--json"]);
      expect(JSON.parse(stdout)).toEqual([]);
      expect(stderr).toBe("");
    }
  });
  it("emits object receipts and sends repeated issues/links without scanning Git", async () => {
    useClient();
    const { stdout, stderr } = await run([
      "release",
      "sync",
      "--pipeline",
      "production",
      "--release-version",
      "1.2",
      "--commit-sha",
      SHA,
      "--issue",
      "eng-1",
      "--issue",
      `ENG-2=${"b".repeat(40)}`,
      "--reverted-issue",
      "ENG-3",
      "--link",
      "CI=https://ci.example/?id=1",
      "--json",
    ]);
    expect(JSON.parse(stdout).id).toBe(ID);
    expect(Array.isArray(JSON.parse(stdout))).toBe(false);
    expect(stderr).toBe("");
    expect(mutationInput("releaseSync")).toMatchObject({
      pipelineId: ID,
      version: "1.2",
      commitSha: SHA,
      issueReferences: [
        { identifier: "ENG-1", commitSha: SHA },
        { identifier: "ENG-2", commitSha: "b".repeat(40) },
      ],
      revertedIssueReferences: [{ identifier: "ENG-3", commitSha: SHA }],
      links: [{ label: "CI", url: "https://ci.example/?id=1" }],
    });
  });
  it("reads Markdown files intact and emits note content on its object", async () => {
    useClient();
    const body = "# Shipped\n\n- ENG-42\n\nLiteral: \\n\n";
    const file = join(dir, "notes.md");
    writeFileSync(file, body);
    const { stdout } = await run([
      "release-note",
      "create",
      "--pipeline",
      "production",
      "--release",
      ID,
      "--body-file",
      file,
      "--title",
      "Release notes",
      "--json",
    ]);
    expect(typeof JSON.parse(stdout).content).toBe("string");
    expect(mutationInput("releaseNoteCreate")).toMatchObject({
      content: body,
      releaseIds: [ID],
      title: "Release notes",
    });
  });
  it("reads descriptions from files and supports deliberate clearing", async () => {
    useClient();
    const file = join(dir, "description.md");
    writeFileSync(file, "Prepare\nDeploy\nVerify\nObserve\n");
    await run(["release", "update", ID, "--description-file", file, "--json"]);
    expect(mutationInput("releaseUpdate").description).toBe("Prepare\nDeploy\nVerify\nObserve\n");
    useClient();
    await run([
      "release",
      "update-version",
      "--pipeline",
      "production",
      "--release-version",
      "1.2",
      "--clear-description",
      "--json",
    ]);
    expect(mutationInput("releaseUpdateByPipeline").description).toBeNull();
  });
  it("keeps false/zero values and explicit collection clearing", async () => {
    useClient();
    await run([
      "release-pipeline",
      "update",
      ID,
      "--production",
      "false",
      "--rollover-issues",
      "false",
      "--clear-paths",
      "--clear-teams",
      "--json",
    ]);
    expect(mutationInput("releasePipelineUpdate")).toMatchObject({
      isProduction: false,
      rolloverIssuesOnCompletion: false,
      includePathPatterns: [],
      teamIds: [],
    });
    useClient();
    await run(["release-stage", "update", ID, "--position", "0", "--frozen", "false", "--json"]);
    expect(mutationInput("releaseStageUpdate")).toMatchObject({ position: 0, frozen: false });
  });
  it("requires --yes for membership removal and note deletion in noninteractive mode", async () => {
    for (const args of [
      ["release", "remove-issue", ID, "ENG-1"],
      ["release-note", "delete", ID],
    ]) {
      useClient();
      await expect(run([...args, "--json"])).rejects.toMatchObject({ code: "usage" });
      expect(
        client.client.rawRequest.mock.calls.every(([q]: [string]) => !q.startsWith("mutation")),
      ).toBe(true);
      const { stdout } = await run([...args, "--json", "--yes"]);
      expect(JSON.parse(stdout)[args[0] === "release" ? "removed" : "deleted"]).toBe(true);
    }
  });
  it("rejects no-op updates and misplaced globals before mutations", async () => {
    for (const args of [
      ["release", "update", ID],
      ["release-pipeline", "update", ID],
      ["release-stage", "update", ID],
      ["release-note", "update", ID],
      ["release", "complete", "--pipeline", ID, "--release-version", "1.2", "--all"],
      ["release", "create", "--name", "n", "--pipeline", ID, "--fields", "id"],
    ]) {
      useClient();
      await expect(run([...args, "--json"])).rejects.toMatchObject({ code: "usage" });
      expect(client.client.rawRequest).not.toHaveBeenCalled();
    }
  });
  it("routes parser errors through the stable JSON stderr envelope with exit 2", () => {
    for (const args of [
      ["release", "complete", "--pipeline", ID],
      ["release-pipeline", "create", "--name", "n", "--type", "invalid"],
      ["release-stage", "create", "--name", "n", "--pipeline", ID],
      ["release-note", "create", "--pipeline", ID, "--release", ID, "--from-release", ID],
      [
        "release",
        "create",
        "--name",
        "n",
        "--pipeline",
        ID,
        "--description",
        "x",
        "--description-file",
        "file",
      ],
      ["release-stage", "update", ID, "--frozen", "yes"],
    ]) {
      const result = spawnSync("bun", ["run", "src/bin/linear.ts", ...args, "--json"], {
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error.code).toBe("usage");
    }
  });
  it("honors stdin Markdown in the CLI process before any auth or API work", () => {
    // Invalid note scope is checked after reading stdin but before obtaining the client.
    const result = spawnSync(
      "bun",
      [
        "--no-env-file",
        join(import.meta.dir, "..", "..", "src", "bin", "linear.ts"),
        "release-note",
        "create",
        "--pipeline",
        ID,
        "--body-file",
        "-",
        "--json",
      ],
      {
        encoding: "utf8",
        input: "# Notes\n\nBody\n",
        cwd: dir,
        env: {
          PATH: process.env.PATH,
          HOME: dir,
          XDG_CONFIG_HOME: join(dir, "config"),
          NO_COLOR: "1",
        },
      },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error.message).toContain("Provide --release");
  });
  it("validates incomplete note ranges before authentication for create and update", () => {
    for (const command of [
      ["create", "--pipeline", ID],
      ["update", ID],
    ]) {
      for (const endpoint of ["--from-release", "--to-release"]) {
        const result = spawnSync(
          "bun",
          [
            "--no-env-file",
            join(import.meta.dir, "..", "..", "src", "bin", "linear.ts"),
            "release-note",
            ...command,
            endpoint,
            ID,
            "--body-file",
            "-",
            "--json",
          ],
          {
            encoding: "utf8",
            input: "# Notes\n",
            cwd: dir,
            env: {
              PATH: process.env.PATH,
              HOME: dir,
              XDG_CONFIG_HOME: join(dir, "config"),
              NO_COLOR: "1",
            },
          },
        );
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        expect(JSON.parse(result.stderr)).toMatchObject({
          error: {
            code: "usage",
            message: "--from-release and --to-release must be provided together.",
          },
        });
      }
    }
  });
});
