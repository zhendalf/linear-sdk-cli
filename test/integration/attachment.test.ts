import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

suite("attachment lifecycle (live)", () => {
  const createdIssues: string[] = [];

  beforeAll(() => ensureBuilt());

  afterAll(() => {
    // Deleting the host issue removes its attachments too; the janitor sweeps the rest.
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

  it("creates an attachment and returns id + title + url", () => {
    const issue = makeIssue("at-create");
    const res = runJson<{ id: string; title: string; url: string }>([
      "attachment",
      "create",
      issue,
      "--url",
      "https://example.com/clitest",
      "--title",
      `${FIXTURE_PREFIX}create`,
    ]);
    expect(res.id).toBeTruthy();
    expect(res.title).toBe(`${FIXTURE_PREFIX}create`);
    expect(res.url).toBe("https://example.com/clitest");
  });

  it("lists attachments on an issue with the expected columns", () => {
    const issue = makeIssue("at-list");
    runJson([
      "attachment",
      "create",
      issue,
      "--url",
      "https://example.com/clitest-listed",
      "--title",
      `${FIXTURE_PREFIX}listed`,
      "--subtitle",
      "a subtitle",
    ]);
    const rows = runJson<Array<{ id: string; title: string; url: string; source: string | null }>>([
      "attachment",
      "list",
      issue,
    ]);
    expect(Array.isArray(rows)).toBe(true);
    const row = rows.find((r) => r.title === `${FIXTURE_PREFIX}listed`);
    expect(row).toBeTruthy();
    expect(row!.url).toBe("https://example.com/clitest-listed");
  });

  it("deletes an attachment by id", () => {
    const issue = makeIssue("at-delete");
    const created = runJson<{ id: string }>([
      "attachment",
      "create",
      issue,
      "--url",
      "https://example.com/clitest-del",
      "--title",
      `${FIXTURE_PREFIX}del`,
    ]);
    const res = runJson<{ id: string; deleted: boolean }>([
      "attachment",
      "delete",
      created.id,
      "--yes",
    ]);
    expect(res.deleted).toBe(true);
    const rows = runJson<Array<{ id: string }>>(["attachment", "list", issue]);
    expect(rows.some((r) => r.id === created.id)).toBe(false);
  });

  it("refuses to delete without confirmation when non-interactive", () => {
    const res = run(["attachment", "delete", "00000000-0000-0000-0000-000000000000", "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });
});
