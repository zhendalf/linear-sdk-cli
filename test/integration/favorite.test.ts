import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

suite("favorite lifecycle (live)", () => {
  // Track created fixtures for cleanup: the favorite (by id) and the backing issue.
  const createdFavoriteIds: string[] = [];
  let issueId: string | undefined;

  beforeAll(() => {
    ensureBuilt();
    // Create a throwaway issue to favorite.
    const issue = runJson<{ id: string; identifier: string }>([
      "issue",
      "create",
      "--team",
      TEAM,
      "--title",
      `${FIXTURE_PREFIX}fav-target`,
    ]);
    issueId = issue.id;
  });

  afterAll(() => {
    for (const id of createdFavoriteIds) {
      run(["favorite", "remove", id, "--yes", "--json"]);
    }
    if (issueId) run(["issue", "delete", issueId, "--yes", "--json"]);
  });

  it("adds a favorite for an issue and returns id + type", () => {
    const res = runJson<{ id: string; type: string }>([
      "favorite",
      "add",
      "--issue",
      issueId!,
    ]);
    expect(res.id).toBeTruthy();
    expect(res.type).toBe("issue");
    createdFavoriteIds.push(res.id);
  });

  it("lists favorites as an array with the expected shape", () => {
    const rows = runJson<Array<{ id: string; type: string; name: string }>>([
      "favorite",
      "list",
    ]);
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length) {
      expect(rows[0]!.id).toBeTruthy();
      expect(typeof rows[0]!.type).toBe("string");
    }
    // The favorite we just created should be present.
    expect(rows.some((r) => createdFavoriteIds.includes(r.id))).toBe(true);
  });

  it("requires exactly one target", () => {
    const none = run(["favorite", "add", "--json"]);
    expect(none.code).toBe(2);
    expect(JSON.parse(none.stderr).error.code).toBe("usage");

    const two = run([
      "favorite",
      "add",
      "--issue",
      issueId!,
      "--project",
      "anything",
      "--json",
    ]);
    expect(two.code).toBe(2);
    expect(JSON.parse(two.stderr).error.code).toBe("usage");
  });

  it("removes a favorite by id", () => {
    const added = runJson<{ id: string }>(["favorite", "add", "--issue", issueId!]);
    const res = runJson<{ id: string; removed: boolean }>([
      "favorite",
      "remove",
      added.id,
      "--yes",
    ]);
    expect(res.id).toBe(added.id);
    expect(res.removed).toBe(true);
  });
});
