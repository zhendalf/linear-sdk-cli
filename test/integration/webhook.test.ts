import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { LinearClient } from "@linear/sdk";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "LIN";
const HOOK_URL = "https://example.com/clitest-hook";

/** A dummy https URL per fixture so leaked webhooks are easy to identify. */
function hookUrl(tag: string): string {
  return `https://example.com/${FIXTURE_PREFIX}${tag}`;
}

suite("webhook lifecycle (live)", () => {
  const createdIds: string[] = [];
  let client: LinearClient;

  beforeAll(() => {
    ensureBuilt();
    client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! });
  });

  // Always sweep created webhooks, even if a test bailed mid-way.
  afterAll(async () => {
    for (const id of createdIds) {
      try {
        await client.deleteWebhook(id);
      } catch {
        // best-effort; the janitor sweeps anything left behind
      }
    }
  });

  /**
   * Create a webhook, or return "limit" when the workspace plan forbids it
   * (some plans gate webhooks). The CLI surfaces that as a forbidden/plan
   * envelope; we skip rather than fail, since it is an environment limit.
   */
  function createOrLimit(args: string[]): { id: string; url: string | null } | "limit" {
    const res = run(["webhook", "create", ...args, "--json"]);
    if (res.code !== 0) {
      const message = JSON.parse(res.stderr).error?.message ?? "";
      if (/plan|upgrade|not enabled|limit|forbidden/i.test(message)) return "limit";
      throw new Error(`webhook create failed (${res.code}): ${res.stderr}`);
    }
    const wh = JSON.parse(res.stdout);
    createdIds.push(wh.id);
    return wh;
  }

  it("creates a webhook scoped to the default team", () => {
    const wh = createOrLimit([
      "--url",
      hookUrl("create"),
      "--resource",
      "Issue",
      "--resource",
      "Comment",
      "--team",
      TEAM,
    ]);
    if (wh === "limit") return;
    expect(wh.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(wh.url).toBe(hookUrl("create"));
  });

  it("lists webhooks with the expected columns", () => {
    const wh = createOrLimit(["--url", hookUrl("list"), "--resource", "Issue", "--team", TEAM]);
    if (wh === "limit") return;
    const rows = runJson<
      Array<{ id: string; url: string; enabled: boolean; resourceTypes: string[] }>
    >(["webhook", "list"]);
    expect(Array.isArray(rows)).toBe(true);
    const found = rows.find((r) => r.id === wh.id);
    expect(found).toBeTruthy();
    expect(found!.enabled).toBe(true);
    expect(found!.resourceTypes).toContain("Issue");
  });

  it("views a webhook by id", () => {
    const wh = createOrLimit(["--url", hookUrl("view"), "--resource", "Issue", "--team", TEAM]);
    if (wh === "limit") return;
    const d = runJson<{ id: string; url: string; enabled: boolean; resourceTypes: string[] }>([
      "webhook",
      "view",
      wh.id,
    ]);
    expect(d.id).toBe(wh.id);
    expect(d.resourceTypes).toContain("Issue");
  });

  it("updates a webhook (disable + change resources)", () => {
    const wh = createOrLimit(["--url", hookUrl("update"), "--resource", "Issue", "--team", TEAM]);
    if (wh === "limit") return;
    const upd = runJson<{ id: string; enabled: boolean; resourceTypes: string[] }>([
      "webhook",
      "update",
      wh.id,
      "--disabled",
      "--resource",
      "Project",
    ]);
    expect(upd.enabled).toBe(false);
    expect(upd.resourceTypes).toEqual(["Project"]);
  });

  it("deletes a webhook", () => {
    const wh = createOrLimit(["--url", hookUrl("delete"), "--resource", "Issue", "--team", TEAM]);
    if (wh === "limit") return;
    const res = runJson<{ id: string; deleted: boolean }>(["webhook", "delete", wh.id, "--yes"]);
    expect(res.deleted).toBe(true);
    // It is gone; drop it from the cleanup list so afterAll doesn't double-delete.
    const i = createdIds.indexOf(wh.id);
    if (i >= 0) createdIds.splice(i, 1);
  });

  it("errors when create is given no resource types", () => {
    const res = run(["webhook", "create", "--url", HOOK_URL, "--team", TEAM, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });

  it("errors when update is given no fields", () => {
    const wh = createOrLimit(["--url", hookUrl("noop"), "--resource", "Issue", "--team", TEAM]);
    if (wh === "limit") return;
    const res = run(["webhook", "update", wh.id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });
});
