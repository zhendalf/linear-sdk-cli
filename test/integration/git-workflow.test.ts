import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

/**
 * `issue describe` is live-testable (it reads a real issue). `issue pull-request`
 * is NOT exercised live: it would shell out to `gh` and create a real PR against
 * whatever repo the suite runs in. Its argv-building and error paths are covered
 * by unit tests in test/unit/git.test.ts.
 */
suite("issue describe (live)", () => {
  const created: string[] = [];

  beforeAll(() => ensureBuilt());
  afterAll(() => {
    for (const id of created) run(["issue", "delete", id, "--yes", "--json"]);
  });

  function makeIssue(title: string): string {
    const res = runJson<{ identifier: string }>([
      "issue",
      "create",
      "--title",
      `${FIXTURE_PREFIX}${title}`,
      "--team",
      TEAM,
    ]);
    created.push(res.identifier);
    return res.identifier;
  }

  it("prints the title and a Fixes <ID> trailer", () => {
    const id = makeIssue("describe");
    const d = runJson<{ identifier: string; title: string; trailer: string }>([
      "issue",
      "describe",
      id,
    ]);
    expect(d.identifier).toBe(id);
    expect(d.title).toContain("describe");
    expect(d.trailer).toBe(`Fixes ${id}`);
  });

  it("uses a References <ID> trailer with --references", () => {
    const id = makeIssue("ref");
    const d = runJson<{ trailer: string }>(["issue", "describe", id, "--references"]);
    expect(d.trailer).toBe(`References ${id}`);
  });

  it("human output is title, blank line, then the trailer", () => {
    const id = makeIssue("human");
    const res = run(["issue", "describe", id]);
    expect(res.code).toBe(0);
    const lines = res.stdout.replace(/\n+$/, "").split("\n");
    expect(lines[0]).toContain("human");
    expect(lines[1]).toBe("");
    expect(lines[lines.length - 1]).toBe(`Fixes ${id}`);
  });
});
