import { describe, it, expect } from "vitest";
import {
  sourceLabel,
  dateStr,
  listAttachments,
  createAttachment,
  deleteAttachment,
} from "../../src/services/attachment.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

/**
 * A client that resolves the issue `TES-1` (via the identifier filter that
 * `resolveIssue` uses) and records mutation inputs. The resolved issue exposes
 * an `attachments()` connection and an id used by `createAttachment`.
 */
function makeClient(record: { create?: any; deleted?: string } = {}) {
  const issue = {
    id: "issue-1",
    identifier: "TES-1",
    attachments: async () => ({
      nodes: [
        {
          id: "att-1",
          title: "Design",
          subtitle: "Figma",
          url: "https://figma.com/x",
          source: { type: "figma" },
          sourceType: "figma",
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
        },
      ],
      pageInfo: { hasNextPage: false },
      fetchNext: async () => ({ nodes: [], pageInfo: { hasNextPage: false } }),
    }),
  };
  return {
    issues: async () => ({ nodes: [issue] }),
    issue: async (id: string) => ({ ...issue, id }),
    attachment: async (id: string) => ({ id, title: "Doomed" }),
    createAttachment: async (input: any) => {
      record.create = input;
      return {
        attachment: Promise.resolve({
          id: "new-att",
          title: input.title,
          url: input.url,
        }),
      };
    },
    deleteAttachment: async (id: string) => {
      record.deleted = id;
      return { success: true };
    },
  } as any;
}

describe("sourceLabel", () => {
  it("prefers sourceType when present", () => {
    expect(sourceLabel({ sourceType: "github", source: { type: "x" } })).toBe("github");
  });
  it("falls back to source.type for an object source", () => {
    expect(sourceLabel({ source: { type: "slack" } })).toBe("slack");
  });
  it("uses a string source directly", () => {
    expect(sourceLabel({ source: "manual" })).toBe("manual");
  });
  it("returns null when there is no source", () => {
    expect(sourceLabel({})).toBeNull();
  });
});

describe("dateStr", () => {
  it("formats a Date as ISO", () => {
    expect(dateStr(new Date("2026-06-01T00:00:00.000Z"))).toBe("2026-06-01T00:00:00.000Z");
  });
  it("passes strings through", () => {
    expect(dateStr("2026-06-01")).toBe("2026-06-01");
  });
});

describe("listAttachments", () => {
  it("resolves the issue and shapes attachment rows", async () => {
    const client = makeClient();
    const rows = await listAttachments(client, "TES-1", 50);
    expect(rows).toEqual([
      {
        id: "att-1",
        title: "Design",
        subtitle: "Figma",
        url: "https://figma.com/x",
        source: "figma",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
  });
});

describe("createAttachment", () => {
  it("builds an AttachmentCreateInput with issueId, url, title, and subtitle", async () => {
    const record: any = {};
    const client = makeClient(record);
    const created = await createAttachment(client, "TES-1", {
      url: "https://example.com",
      title: "Spec",
      subtitle: "v2",
    });
    expect(record.create).toEqual({
      issueId: "issue-1",
      url: "https://example.com",
      title: "Spec",
      subtitle: "v2",
    });
    expect(created.id).toBe("new-att");
  });

  it("omits subtitle when not provided", async () => {
    const record: any = {};
    const client = makeClient(record);
    await createAttachment(client, "TES-1", { url: "https://example.com", title: "Spec" });
    expect(record.create).toEqual({
      issueId: "issue-1",
      url: "https://example.com",
      title: "Spec",
    });
  });
});

describe("deleteAttachment", () => {
  it("deletes by id and returns the removed attachment's id/title", async () => {
    const record: any = {};
    const client = makeClient(record);
    const res = await deleteAttachment(client, UUID);
    expect(record.deleted).toBe(UUID);
    expect(res).toEqual({ id: UUID, title: "Doomed" });
  });
});
