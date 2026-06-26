import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

suite("document — document lifecycle (live)", () => {
  const created: string[] = [];

  beforeAll(() => ensureBuilt());

  afterAll(() => {
    // Best-effort cleanup; the janitor sweeps anything this misses.
    for (const id of created) run(["document", "delete", id, "--yes", "--json"]);
  });

  function makeDocument(name: string, extra: string[] = []): { id: string; title: string } {
    const res = runJson<{ id: string; title: string }>([
      "document",
      "create",
      "--title",
      `${FIXTURE_PREFIX}${name}`,
      "--team",
      TEAM,
      ...extra,
    ]);
    created.push(res.id);
    return res;
  }

  it("creates a document and returns id + url", () => {
    const res = runJson<{ id: string; title: string; url: string }>([
      "document",
      "create",
      "--title",
      `${FIXTURE_PREFIX}create`,
      "--team",
      TEAM,
      "--content",
      "# Made by the test suite",
    ]);
    created.push(res.id);
    expect(res.id).toBeTruthy();
    expect(res.url).toContain("linear.app");
  });

  it("views a document including its content", () => {
    const { id, title } = makeDocument("view", ["--content", "hello world body"]);
    const d = runJson<{ id: string; title: string; content: string | null }>([
      "document",
      "view",
      id,
    ]);
    expect(d.id).toBe(id);
    expect(d.title).toBe(title);
    expect(d.content).toContain("hello world body");
  });

  it("updates the title and content", () => {
    const { id } = makeDocument("update");
    runJson([
      "document",
      "update",
      id,
      "--title",
      `${FIXTURE_PREFIX}updated`,
      "--content",
      "revised body",
    ]);
    const d = runJson<{ title: string; content: string | null }>(["document", "view", id]);
    expect(d.title).toBe(`${FIXTURE_PREFIX}updated`);
    expect(d.content).toContain("revised body");
  });

  it("lists documents and includes a created one", () => {
    const { id } = makeDocument("list");
    const rows = runJson<Array<{ id: string }>>(["document", "list", "--limit", "100"]);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((r) => r.id === id)).toBe(true);
  });

  it("rejects an update with no fields", () => {
    const { id } = makeDocument("noop");
    const res = run(["document", "update", id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });

  it("deletes a document", () => {
    const { id } = makeDocument("delete");
    const res = runJson<{ deleted: boolean }>(["document", "delete", id, "--yes"]);
    expect(res.deleted).toBe(true);
    const idx = created.indexOf(id);
    if (idx >= 0) created.splice(idx, 1);
  });

  it("refuses to delete without --yes in non-interactive mode", () => {
    const { id } = makeDocument("noyes");
    const res = run(["document", "delete", id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });
});
