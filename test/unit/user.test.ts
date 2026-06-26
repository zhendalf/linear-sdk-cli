import { describe, it, expect } from "bun:test";
import { listUsers, getUserDetail, getViewer } from "../../src/services/user.js";

/** Build a fake User SDK model. */
function fakeUser(over: Record<string, any> = {}): Record<string, any> {
  return {
    id: "u1",
    displayName: "ada",
    name: "Ada Lovelace",
    email: "ada@example.com",
    active: true,
    admin: false,
    guest: false,
    isMe: false,
    description: null,
    statusLabel: null,
    timezone: "UTC",
    url: "https://linear.app/u/ada",
    avatarUrl: null,
    lastSeen: new Date("2026-01-02T03:04:05.000Z"),
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  };
}

/** A connection whose nodes are returned by collect() without paging. */
function conn(nodes: any[]): any {
  return { nodes, pageInfo: { hasNextPage: false }, fetchNext: async () => conn(nodes) };
}

describe("listUsers", () => {
  it("maps the user connection to display rows", async () => {
    const client = {
      users: async () => conn([fakeUser(), fakeUser({ id: "u2", displayName: "grace", admin: true })]),
    } as any;
    const rows = await listUsers(client, 50);
    expect(rows).toEqual([
      {
        id: "u1",
        displayName: "ada",
        name: "Ada Lovelace",
        email: "ada@example.com",
        active: true,
        admin: false,
        guest: false,
      },
      {
        id: "u2",
        displayName: "grace",
        name: "Ada Lovelace",
        email: "ada@example.com",
        active: true,
        admin: true,
        guest: false,
      },
    ]);
  });

  it("requests at most 100 per page even for a large limit", async () => {
    let requested: number | undefined;
    const client = {
      users: async (vars: any) => {
        requested = vars.first;
        return conn([fakeUser()]);
      },
    } as any;
    await listUsers(client, Infinity);
    expect(requested).toBe(100);
  });
});

describe("getUserDetail", () => {
  it("resolves a user id (uuid passes through) and shapes the detail", async () => {
    const id = "01234567-89ab-cdef-0123-456789abcdef";
    let lookedUp: string | undefined;
    const client = {
      user: async (uid: string) => {
        lookedUp = uid;
        return fakeUser({ id: uid, statusLabel: "On vacation", description: "Engineer" });
      },
    } as any;
    const d = await getUserDetail(client, id);
    expect(lookedUp).toBe(id);
    expect(d.id).toBe(id);
    expect(d.statusLabel).toBe("On vacation");
    expect(d.description).toBe("Engineer");
    expect(d.lastSeen).toBe("2026-01-02T03:04:05.000Z");
    expect(d.createdAt).toBe("2025-01-01T00:00:00.000Z");
  });

  it("resolves 'me' via the viewer", async () => {
    const client = {
      viewer: Promise.resolve(fakeUser({ id: "viewer-id" })),
      user: async (uid: string) => fakeUser({ id: uid, isMe: true }),
    } as any;
    const d = await getUserDetail(client, "me");
    expect(d.id).toBe("viewer-id");
    expect(d.isMe).toBe(true);
  });
});

describe("getViewer", () => {
  it("shapes the authenticated viewer", async () => {
    const client = {
      viewer: Promise.resolve(fakeUser({ id: "me-id", displayName: "me", isMe: true })),
    } as any;
    const d = await getViewer(client);
    expect(d.id).toBe("me-id");
    expect(d.isMe).toBe(true);
    expect(d.email).toBe("ada@example.com");
  });
});
