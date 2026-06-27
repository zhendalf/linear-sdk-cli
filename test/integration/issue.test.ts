import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

suite("phase 1 — issue lifecycle (live)", () => {
  const created: string[] = [];

  beforeAll(() => ensureBuilt());

  afterAll(() => {
    // Best-effort cleanup; the janitor sweeps anything this misses.
    for (const id of created) run(["issue", "delete", id, "--yes", "--json"]);
  });

  function makeIssue(title: string, extra: string[] = []): string {
    const res = runJson<{ identifier: string }>([
      "issue",
      "create",
      "--title",
      `${FIXTURE_PREFIX}${title}`,
      "--team",
      TEAM,
      ...extra,
    ]);
    created.push(res.identifier);
    return res.identifier;
  }

  it("creates an issue and returns identifier + url", () => {
    const res = runJson<{ identifier: string; url: string }>([
      "issue",
      "create",
      "--title",
      `${FIXTURE_PREFIX}create`,
      "--team",
      TEAM,
      "--priority",
      "2",
    ]);
    created.push(res.identifier);
    expect(res.identifier).toMatch(/^[A-Z]+-\d+$/);
    expect(res.url).toContain("linear.app");
  });

  it("views an issue with resolved relations", () => {
    const id = makeIssue("view");
    const d = runJson<{ identifier: string; priorityLabel: string; team: string }>([
      "issue",
      "view",
      id,
    ]);
    expect(d.identifier).toBe(id);
    expect(d.team).toContain(TEAM);
  });

  it("updates title, priority, state and assignee", () => {
    const id = makeIssue("update");
    runJson(["issue", "update", id, "--title", `${FIXTURE_PREFIX}updated`, "--priority", "1"]);
    runJson(["issue", "assign", id, "me"]);
    runJson(["issue", "state", id, "started"]);
    const d = runJson<{ title: string; priority: number; assignee: string | null }>([
      "issue",
      "view",
      id,
    ]);
    expect(d.title).toBe(`${FIXTURE_PREFIX}updated`);
    expect(d.priority).toBe(1);
    expect(d.assignee).toBeTruthy();
  });

  it("adds and lists comments", () => {
    const id = makeIssue("comment");
    runJson(["issue", "comment", id, "hello from the test suite"]);
    const comments = runJson<Array<{ body: string }>>(["issue", "comments", id]);
    expect(comments.some((c) => c.body.includes("hello from the test suite"))).toBe(true);
  });

  it("lists issues filtered by team and assignee", () => {
    const id = makeIssue("list", ["--assignee", "me"]);
    const rows = runJson<Array<{ identifier: string }>>([
      "issue",
      "list",
      "--team",
      TEAM,
      "--assignee",
      "me",
      "--limit",
      "50",
    ]);
    expect(rows.some((r) => r.identifier === id)).toBe(true);
  });

  it("manages blocks/blocked-by relations in both directions", () => {
    const a = makeIssue("rel-a");
    const b = makeIssue("rel-b");
    runJson(["issue", "relation", a, "add", b, "--blocked-by"]);
    const relsA = runJson<Array<{ type: string; issue: string }>>(["issue", "relation", a, "list"]);
    expect(relsA.find((r) => r.issue === b)?.type).toBe("blocked_by");
    const relsB = runJson<Array<{ type: string; issue: string }>>(["issue", "relation", b, "list"]);
    expect(relsB.find((r) => r.issue === a)?.type).toBe("blocks");
    runJson(["issue", "relation", a, "remove", b, "--blocked-by"]);
  });

  it("archives then deletes an issue", () => {
    const id = makeIssue("archive");
    expect(runJson<{ archived: boolean }>(["issue", "archive", id, "--yes"]).archived).toBe(true);
    runJson(["issue", "unarchive", id]);
    const del = runJson<{ deleted: boolean }>(["issue", "delete", id, "--yes"]);
    expect(del.deleted).toBe(true);
    // already deleted; drop from cleanup list
    const idx = created.indexOf(id);
    if (idx >= 0) created.splice(idx, 1);
  });

  it("refuses to delete without --yes in non-interactive mode", () => {
    const id = makeIssue("noyes");
    const res = run(["issue", "delete", id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });

  it("sorts by priority urgency descending across the result (Urgent before Low)", () => {
    const urgent = makeIssue("p-urgent", ["--priority", "1"]);
    const low = makeIssue("p-low", ["--priority", "4"]);
    const rows = runJson<Array<{ identifier: string }>>([
      "issue",
      "list",
      "--team",
      TEAM,
      "--sort",
      "priority",
      "--limit",
      "100",
    ]);
    const iu = rows.findIndex((r) => r.identifier === urgent);
    const il = rows.findIndex((r) => r.identifier === low);
    expect(iu).toBeGreaterThanOrEqual(0);
    expect(il).toBeGreaterThanOrEqual(0);
    expect(iu).toBeLessThan(il);
  });

  it("gives a usage error for assign with an id-shaped single arg (missing assignee)", () => {
    const id = makeIssue("assignerr");
    const res = run(["issue", "assign", id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });
});
