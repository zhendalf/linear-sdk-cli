import { describe, it, expect, vi } from "bun:test";
import {
  listNotifications,
  setRead,
  snoozeNotification,
  markAllRead,
  archiveNotification,
} from "../../src/services/notification.js";

/** Build a mock LinearClient whose rawRequest returns one page of nodes. */
function listClient(nodes: any[]) {
  return {
    client: {
      rawRequest: vi.fn().mockResolvedValue({
        data: { notifications: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } },
      }),
    },
  } as any;
}

describe("listNotifications", () => {
  it("maps the issue subject and read flag", async () => {
    const client = listClient([
      {
        __typename: "IssueNotification",
        id: "n1",
        type: "issueAssigned",
        readAt: "2026-06-01T00:00:00.000Z",
        snoozedUntilAt: null,
        archivedAt: null,
        createdAt: "2026-05-30T00:00:00.000Z",
        issue: { identifier: "TES-7", title: "Fix login" },
      },
    ]);
    const rows = await listNotifications(client, 50, false);
    expect(rows).toEqual([
      {
        id: "n1",
        type: "issueAssigned",
        subject: "TES-7 Fix login",
        read: true,
        readAt: "2026-06-01T00:00:00.000Z",
        snoozedUntilAt: null,
        archivedAt: null,
        createdAt: "2026-05-30T00:00:00.000Z",
      },
    ]);
  });

  it("treats a null readAt as unread and derives a project subject", async () => {
    const client = listClient([
      {
        __typename: "ProjectNotification",
        id: "n2",
        type: "projectUpdate",
        readAt: null,
        snoozedUntilAt: null,
        archivedAt: null,
        createdAt: "2026-05-30T00:00:00.000Z",
        project: { name: "Roadmap" },
      },
    ]);
    const rows = await listNotifications(client, 50, false);
    expect(rows[0]!.read).toBe(false);
    expect(rows[0]!.subject).toBe("Roadmap");
  });

  it("tolerates an empty notification list", async () => {
    const rows = await listNotifications(listClient([]), 50, false);
    expect(rows).toEqual([]);
  });

  it("falls back to __typename when type is absent and has no known subject", async () => {
    const client = listClient([
      {
        __typename: "WelcomeMessageNotification",
        id: "n3",
        type: null,
        readAt: null,
        createdAt: "2026-05-30T00:00:00.000Z",
      },
    ]);
    const rows = await listNotifications(client, 50, false);
    expect(rows[0]!.type).toBe("WelcomeMessageNotification");
    expect(rows[0]!.subject).toBeNull();
  });

  it("passes includeArchived through to the query", async () => {
    const client = listClient([]);
    await listNotifications(client, 50, true);
    expect(client.client.rawRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ includeArchived: true }),
    );
  });
});

describe("setRead", () => {
  it("marks read with an ISO readAt timestamp", async () => {
    const updateNotification = vi
      .fn()
      .mockResolvedValue({ success: true });
    const client = { updateNotification } as any;
    await setRead(client, "n1", true);
    const [id, input] = updateNotification.mock.calls[0]!;
    expect(id).toBe("n1");
    expect(typeof input.readAt).toBe("string");
    expect(() => new Date(input.readAt).toISOString()).not.toThrow();
  });

  it("marks unread with a null readAt", async () => {
    const updateNotification = vi
      .fn()
      .mockResolvedValue({ success: true });
    const client = { updateNotification } as any;
    await setRead(client, "n1", false);
    expect(updateNotification.mock.calls[0]![1]).toEqual({ readAt: null });
  });
});

// The service used to hand `{ id, success }` back and let the command emit
// `read: true` regardless. It now throws unless the API confirmed the write, so
// the receipt the command prints is a fact rather than a restatement of intent.
describe("notification writes are confirmed, not assumed", () => {
  it("returns a receipt describing what the API confirmed", async () => {
    const client = { updateNotification: vi.fn().mockResolvedValue({ success: true }) } as any;
    expect(await setRead(client, "n1", true)).toEqual({ id: "n1", read: true });
    expect(await setRead(client, "n1", false)).toEqual({ id: "n1", read: false });
  });

  it("fails a read that the API refused", async () => {
    const client = { updateNotification: vi.fn().mockResolvedValue({ success: false }) } as any;
    await expect(setRead(client, "n1", true)).rejects.toMatchObject({ code: "api", exitCode: 1 });
  });

  it("fails a snooze that the API refused", async () => {
    const client = { updateNotification: vi.fn().mockResolvedValue({ success: false }) } as any;
    await expect(snoozeNotification(client, "n1", "2026-07-01T09:00:00Z")).rejects.toMatchObject({
      code: "api",
    });
  });

  it("fails an archive that the API refused", async () => {
    const client = { archiveNotification: vi.fn().mockResolvedValue({ success: false }) } as any;
    await expect(archiveNotification(client, "n1")).rejects.toMatchObject({ code: "api" });
  });
});

describe("snoozeNotification", () => {
  it("passes snoozedUntilAt through unchanged", async () => {
    const updateNotification = vi
      .fn()
      .mockResolvedValue({ success: true });
    const client = { updateNotification } as any;
    const until = "2026-07-01T09:00:00.000Z";
    await snoozeNotification(client, "n1", until);
    expect(updateNotification.mock.calls[0]![1]).toEqual({ snoozedUntilAt: until });
  });
});

describe("markAllRead", () => {
  it("marks each unread notification read (skipping already-read ones)", async () => {
    // markAllRead enumerates notifications via the list query and updates the
    // unread ones (notificationMarkReadAll rejects an empty entity input).
    const rawRequest = vi.fn().mockResolvedValue({
      data: {
        notifications: {
          nodes: [
            { __typename: "IssueNotification", id: "n1", type: "issueAssigned", readAt: null, snoozedUntilAt: null, archivedAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
            { __typename: "IssueNotification", id: "n2", type: "issueAssigned", readAt: "2026-01-01T00:00:00.000Z", snoozedUntilAt: null, archivedAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
            { __typename: "IssueNotification", id: "n3", type: "issueAssigned", readAt: null, snoozedUntilAt: null, archivedAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
          ],
          pageInfo: { hasNextPage: false },
        },
      },
    });
    const updateNotification = vi.fn().mockResolvedValue({ success: true });
    const client = { client: { rawRequest }, updateNotification } as any;

    const res = await markAllRead(client);
    expect(res).toEqual({ success: true, count: 2, attempted: 2, failed: [] });
    expect(updateNotification).toHaveBeenCalledTimes(2);
    expect(updateNotification.mock.calls.map((c) => c[0])).toEqual(["n1", "n3"]);
    expect(updateNotification.mock.calls[0]![1]).toHaveProperty("readAt");
  });

  // The batch used to hardcode `success: true` and report every unread item as
  // marked, whatever the API said per item. The aggregate is now derived.
  it("reports the true per-item outcome when one of the writes is refused", async () => {
    const rawRequest = vi.fn().mockResolvedValue({
      data: {
        notifications: {
          nodes: ["n1", "n2", "n3"].map((id) => ({
            __typename: "IssueNotification",
            id,
            type: "issueAssigned",
            readAt: null,
            snoozedUntilAt: null,
            archivedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          })),
          pageInfo: { hasNextPage: false },
        },
      },
    });
    const updateNotification = vi.fn(async (id: string) => ({ success: id !== "n2" }));
    const client = { client: { rawRequest }, updateNotification } as any;

    const res = await markAllRead(client);
    expect(res.success).toBe(false);
    expect(res.count).toBe(2);
    expect(res.attempted).toBe(3);
    expect(res.failed.map((f) => f.id)).toEqual(["n2"]);
    expect(res.failed[0]!.error).toMatch(/success: false/);
    // One refusal does not abort the rest: n3 was still attempted.
    expect(updateNotification.mock.calls.map((c) => c[0])).toEqual(["n1", "n2", "n3"]);
  });
});
