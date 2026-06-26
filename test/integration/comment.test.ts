import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

suite("comment lifecycle (live)", () => {
  const createdIssues: string[] = [];

  beforeAll(() => ensureBuilt());

  afterAll(() => {
    // Deleting the host issue removes its comments too; the janitor sweeps the rest.
    for (const id of createdIssues) run(["issue", "delete", id, "--yes", "--json"]);
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
    createdIssues.push(res.identifier);
    return res.identifier;
  }

  it("adds a comment and returns id + issue + url", () => {
    const issue = makeIssue("cm-add");
    const res = runJson<{ id: string; issue: string; url: string }>([
      "comment",
      "add",
      issue,
      `${FIXTURE_PREFIX}body`,
    ]);
    expect(res.id).toBeTruthy();
    expect(res.issue).toBe(issue);
    expect(res.url).toContain("linear.app");
  });

  it("lists comments on an issue with the expected columns", () => {
    const issue = makeIssue("cm-list");
    runJson(["comment", "add", issue, `${FIXTURE_PREFIX}listed`]);
    const rows = runJson<Array<{ id: string; author: string; body: string; createdAt: string }>>([
      "comment",
      "list",
      issue,
    ]);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((r) => r.body.includes(`${FIXTURE_PREFIX}listed`))).toBe(true);
    expect(rows[0]!.createdAt).toBeTruthy();
  });

  it("replies to a comment, nesting it under the parent", () => {
    const issue = makeIssue("cm-reply");
    const parent = runJson<{ id: string }>(["comment", "add", issue, `${FIXTURE_PREFIX}parent`]);
    const reply = runJson<{ id: string; parent: string; issue: string }>([
      "comment",
      "reply",
      parent.id,
      `${FIXTURE_PREFIX}reply`,
    ]);
    expect(reply.id).toBeTruthy();
    expect(reply.parent).toBe(parent.id);
    expect(reply.issue).toBe(issue);
  });

  it("updates a comment's body", () => {
    const issue = makeIssue("cm-update");
    const c = runJson<{ id: string }>(["comment", "add", issue, `${FIXTURE_PREFIX}orig`]);
    const updated = runJson<{ id: string }>([
      "comment",
      "update",
      c.id,
      `${FIXTURE_PREFIX}edited`,
    ]);
    expect(updated.id).toBe(c.id);
    const rows = runJson<Array<{ id: string; body: string }>>(["comment", "list", issue]);
    expect(rows.find((r) => r.id === c.id)?.body).toBe(`${FIXTURE_PREFIX}edited`);
  });

  it("resolves and unresolves a comment thread", () => {
    const issue = makeIssue("cm-resolve");
    const c = runJson<{ id: string }>(["comment", "add", issue, `${FIXTURE_PREFIX}resolveme`]);
    const resolved = runJson<{ id: string; resolved: boolean }>(["comment", "resolve", c.id]);
    expect(resolved.resolved).toBe(true);
    const unresolved = runJson<{ id: string; resolved: boolean }>(["comment", "unresolve", c.id]);
    expect(unresolved.resolved).toBe(false);
  });

  it("deletes a comment", () => {
    const issue = makeIssue("cm-delete");
    const c = runJson<{ id: string }>(["comment", "add", issue, `${FIXTURE_PREFIX}deleteme`]);
    const del = runJson<{ id: string; deleted: boolean }>([
      "comment",
      "delete",
      c.id,
      "--yes",
    ]);
    expect(del.deleted).toBe(true);
  });

  it("refuses to delete a comment without --yes in non-interactive mode", () => {
    const issue = makeIssue("cm-noyes");
    const c = runJson<{ id: string }>(["comment", "add", issue, `${FIXTURE_PREFIX}noyes`]);
    const res = run(["comment", "delete", c.id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });
});
