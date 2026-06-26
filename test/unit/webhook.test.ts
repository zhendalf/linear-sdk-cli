import { describe, it, expect, vi } from "bun:test";
import { createWebhook, updateWebhook } from "../../src/services/webhook.js";

/** Minimal mock LinearClient: records the input passed to create/update. */
function mockClient(overrides: Record<string, any> = {}) {
  const calls: { create?: any; update?: any } = {};
  const client: any = {
    teams: vi.fn(async () => ({
      nodes: [{ id: "team-uuid", key: "TES", name: "Test" }],
    })),
    createWebhook: vi.fn(async (input: any) => {
      calls.create = input;
      return { webhook: Promise.resolve({ id: "wh-1", url: input.url, enabled: true, resourceTypes: input.resourceTypes }) };
    }),
    updateWebhook: vi.fn(async (_id: string, input: any) => {
      calls.update = input;
      return { webhook: Promise.resolve({ id: "wh-1", url: input.url, enabled: input.enabled, resourceTypes: input.resourceTypes }) };
    }),
    ...overrides,
  };
  return { client, calls };
}

describe("createWebhook", () => {
  it("builds an input with url + resourceTypes and unwraps the payload", async () => {
    const { client, calls } = mockClient();
    const wh = await createWebhook(client, {
      url: "https://example.com/hook",
      resourceTypes: ["Issue", "Comment"],
      allPublicTeams: true,
    });
    expect(calls.create).toEqual({
      url: "https://example.com/hook",
      resourceTypes: ["Issue", "Comment"],
      allPublicTeams: true,
    });
    expect(wh.id).toBe("wh-1");
  });

  it("normalizes resource-type casing and rejects unknown types", async () => {
    const { client, calls } = mockClient();
    await createWebhook(client, {
      url: "https://example.com/hook",
      resourceTypes: ["issue", "issuesla"],
      allPublicTeams: true,
    });
    expect(calls.create.resourceTypes).toEqual(["Issue", "IssueSLA"]);

    await expect(
      createWebhook(client, {
        url: "https://example.com/hook",
        resourceTypes: ["Bogus"],
        allPublicTeams: true,
      }),
    ).rejects.toMatchObject({ code: "usage" });
  });

  it("requires a scope (team or --all-public)", async () => {
    const { client } = mockClient();
    await expect(
      createWebhook(client, { url: "https://example.com/hook", resourceTypes: ["Issue"] }),
    ).rejects.toMatchObject({ code: "usage" });
  });

  it("resolves the team key to a teamId", async () => {
    const { client, calls } = mockClient();
    await createWebhook(client, {
      url: "https://example.com/hook",
      resourceTypes: ["Issue"],
      team: "TES",
    });
    expect(calls.create.teamId).toBe("team-uuid");
  });

  it("passes label, secret, and allPublicTeams through", async () => {
    const { client, calls } = mockClient();
    await createWebhook(client, {
      url: "https://example.com/hook",
      resourceTypes: ["Issue"],
      label: "clitest",
      secret: "s3cr3t",
      allPublicTeams: true,
    });
    expect(calls.create.label).toBe("clitest");
    expect(calls.create.secret).toBe("s3cr3t");
    expect(calls.create.allPublicTeams).toBe(true);
  });

  it("throws a usage error when no resource types are given", async () => {
    const { client } = mockClient();
    await expect(
      createWebhook(client, { url: "https://example.com/hook", resourceTypes: [] }),
    ).rejects.toMatchObject({ code: "usage" });
  });

  it("throws a usage error when url is missing", async () => {
    const { client } = mockClient();
    await expect(
      createWebhook(client, { url: "", resourceTypes: ["Issue"] }),
    ).rejects.toMatchObject({ code: "usage" });
  });
});

describe("updateWebhook", () => {
  it("only sets fields that were provided", async () => {
    const { client, calls } = mockClient();
    await updateWebhook(client, "wh-1", { enabled: false });
    expect(calls.update).toEqual({ enabled: false });
  });

  it("sets resourceTypes when provided", async () => {
    const { client, calls } = mockClient();
    await updateWebhook(client, "wh-1", { resourceTypes: ["Project"] });
    expect(calls.update).toEqual({ resourceTypes: ["Project"] });
  });

  it("throws a usage error when nothing is provided", async () => {
    const { client } = mockClient();
    await expect(updateWebhook(client, "wh-1", {})).rejects.toMatchObject({ code: "usage" });
  });

  it("throws a usage error when resourceTypes is empty", async () => {
    const { client } = mockClient();
    await expect(
      updateWebhook(client, "wh-1", { resourceTypes: [] }),
    ).rejects.toMatchObject({ code: "usage" });
  });
});
