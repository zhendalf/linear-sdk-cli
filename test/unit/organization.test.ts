import { describe, it, expect } from "bun:test";
import {
  getOrganizationDetail,
  listMembers,
  listInvites,
  inviteStatus,
} from "../../src/services/organization.js";
import { connection } from "./_fakes.js";

// A faithful SDK connection (see _fakes.ts): fetchNext() mutates and returns
// `this`, which is what the real one does and what an ad-hoc literal did not.
const conn = <T,>(nodes: T[]) => connection(nodes) as any;

describe("getOrganizationDetail", () => {
  it("maps the workspace getter to a flat detail object", async () => {
    const client = {
      organization: Promise.resolve({
        id: "org-1",
        name: "Acme",
        urlKey: "acme",
        userCount: 7,
        createdIssueCount: 123,
        samlEnabled: false,
        scimEnabled: true,
        roadmapEnabled: true,
        logoUrl: null,
        createdAt: new Date("2021-01-02T03:04:05.000Z"),
        updatedAt: new Date("2022-02-03T04:05:06.000Z"),
      }),
    } as any;
    const d = await getOrganizationDetail(client);
    expect(d).toMatchObject({
      id: "org-1",
      name: "Acme",
      urlKey: "acme",
      userCount: 7,
      createdIssueCount: 123,
      samlEnabled: false,
      scimEnabled: true,
      roadmapEnabled: true,
      logoUrl: null,
    });
    expect(d.createdAt).toBe("2021-01-02T03:04:05.000Z");
    expect(d.updatedAt).toBe("2022-02-03T04:05:06.000Z");
  });
});

describe("listMembers", () => {
  it("maps users to displayName/email/admin/active rows", async () => {
    const client = {
      users: async () =>
        conn([
          { id: "u1", displayName: "Ada", name: "Ada L", email: "ada@x.io", admin: true, active: true },
          { id: "u2", displayName: "Bob", name: "Bob R", email: "bob@x.io", admin: false, active: false },
        ]),
    } as any;
    const rows = await listMembers(client, 50);
    expect(rows).toEqual([
      { id: "u1", displayName: "Ada", name: "Ada L", email: "ada@x.io", admin: true, active: true },
      { id: "u2", displayName: "Bob", name: "Bob R", email: "bob@x.io", admin: false, active: false },
    ]);
  });
});

describe("inviteStatus", () => {
  it("returns 'accepted' when acceptedAt is set", () => {
    expect(inviteStatus({ acceptedAt: new Date() })).toBe("accepted");
  });
  it("returns 'expired' when expiresAt is in the past", () => {
    expect(inviteStatus({ expiresAt: new Date(Date.now() - 1000) })).toBe("expired");
  });
  it("returns 'pending' otherwise", () => {
    expect(inviteStatus({})).toBe("pending");
    expect(inviteStatus({ expiresAt: new Date(Date.now() + 1_000_000) })).toBe("pending");
  });
});

describe("listInvites", () => {
  it("maps invites and derives status; tolerates an empty list", async () => {
    const empty = { organizationInvites: async () => conn([]) } as any;
    expect(await listInvites(empty, 50)).toEqual([]);

    const client = {
      organizationInvites: async () =>
        conn([
          {
            id: "inv1",
            email: "new@x.io",
            role: "member",
            external: false,
            acceptedAt: null,
            expiresAt: null,
            createdAt: new Date("2023-03-04T05:06:07.000Z"),
          },
        ]),
    } as any;
    const rows = await listInvites(client, 50);
    expect(rows).toEqual([
      {
        id: "inv1",
        email: "new@x.io",
        status: "pending",
        role: "member",
        external: false,
        createdAt: "2023-03-04T05:06:07.000Z",
      },
    ]);
  });
});
