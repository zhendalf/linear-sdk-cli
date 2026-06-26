import { describe, it, expect, beforeAll } from "vitest";
import { run, runJson, LIVE, ensureBuilt } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;

interface NotificationRow {
  id: string;
  type: string;
  subject: string | null;
  read: boolean;
  readAt: string | null;
  snoozedUntilAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}

/**
 * You cannot create a notification via the API, so these tests degrade
 * gracefully: the list may be empty, and every by-id mutation skips when there
 * is nothing to act on.
 */
suite("notification (live)", () => {
  beforeAll(() => ensureBuilt());

  function firstNotification(): NotificationRow | undefined {
    const rows = runJson<NotificationRow[]>(["notification", "list"]);
    return rows[0];
  }

  it("lists notifications (tolerating an empty inbox)", () => {
    const rows = runJson<NotificationRow[]>(["notification", "list"]);
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length) {
      expect(rows[0]).toHaveProperty("id");
      expect(rows[0]).toHaveProperty("type");
      expect(typeof rows[0]!.read).toBe("boolean");
    }
  });

  it("marks a notification read then unread", (ctx) => {
    const n = firstNotification();
    if (!n) return ctx.skip();
    const read = runJson<{ id: string; read: boolean }>(["notification", "read", n.id]);
    expect(read.read).toBe(true);
    const unread = runJson<{ id: string; read: boolean }>(["notification", "unread", n.id]);
    expect(unread.read).toBe(false);
  });

  it("snoozes a notification until a future ISO timestamp", (ctx) => {
    const n = firstNotification();
    if (!n) return ctx.skip();
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const res = runJson<{ id: string; snoozedUntilAt: string }>([
      "notification",
      "snooze",
      n.id,
      until,
    ]);
    expect(res.snoozedUntilAt).toBe(until);
  });

  it("marks all notifications read", () => {
    const res = runJson<{ success: boolean }>(["notification", "read-all"]);
    expect(typeof res.success).toBe("boolean");
  });

  it("requires --yes to archive in a non-TTY", (ctx) => {
    const n = firstNotification();
    if (!n) return ctx.skip();
    // Without --yes (and no TTY in CI) the destructive guard refuses (exit 2).
    const refused = run(["notification", "archive", n.id, "--json"]);
    expect(refused.code).toBe(2);
    expect(JSON.parse(refused.stderr).error.code).toBe("usage");
    // With --yes it archives.
    const ok = runJson<{ id: string; archived: boolean }>([
      "notification",
      "archive",
      n.id,
      "--yes",
    ]);
    expect(ok.archived).toBe(true);
  });
});
