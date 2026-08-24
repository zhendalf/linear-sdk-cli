import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sourceLabel,
  dateStr,
  listAttachments,
  createAttachment,
  deleteAttachment,
  attachFiles,
} from "../../src/services/attachment.js";
import { connection, payload } from "./_fakes.js";

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
    issues: async () => connection([issue]),
    issue: async (id: string) => ({ ...issue, id }),
    attachment: async (id: string) => ({ id, title: "Doomed" }),
    createAttachment: async (input: any) => {
      record.create = input;
      return {
        success: true,
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

/**
 * `attachFiles` — `issue attach <issue> <file...>` (TES-602): each file is
 * uploaded (signed URL + PUT) and then attached by its asset URL. The batch is
 * validated BEFORE anything is uploaded, so a typo in file 3 does not leave
 * files 1–2 uploaded and orphaned; `--comment` posts ONE comment embedding
 * every file as markdown; `--public` is refused for non-images before any
 * network work.
 */
describe("attachFiles", () => {
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  let dir: string;
  let png: string;
  let txt: string;
  let calls: string[];
  let savedFetch: typeof fetch;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "linattach-"));
    png = join(dir, "shot.png");
    txt = join(dir, "notes.txt");
    writeFileSync(png, PNG);
    writeFileSync(txt, "hello");
    calls = [];
    savedFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      calls.push(`PUT ${String(url).split("?")[0]}`);
      return new Response("", { status: 200 });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = savedFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  function uploadingClient(record: { create: any[]; comment?: any } = { create: [] }) {
    const base = makeClient();
    let n = 0;
    return {
      ...base,
      fileUpload: async (contentType: string, filename: string, size: number, vars: any) => {
        calls.push(`fileUpload ${filename} ${contentType} ${size} public=${vars.makePublic}`);
        n++;
        return payload("uploadFile", {
          assetUrl: `https://uploads.linear.app/ws/${n}`,
          uploadUrl: `https://storage.googleapis.com/b/${n}?X-Goog-Signature=s${n}`,
          headers: [{ key: "x-goog-content-length-range", value: `${size},${size}` }],
        });
      },
      createAttachment: async (input: any) => {
        calls.push(`createAttachment ${input.title}`);
        record.create.push(input);
        return payload("attachment", {
          id: `att-${record.create.length}`,
          title: input.title,
          url: input.url,
        });
      },
      createComment: async (input: any) => {
        calls.push("createComment");
        record.comment = input;
        return payload("comment", { id: "cm-1", url: "https://linear.app/c/1" });
      },
    } as any;
  }

  it("uploads each file, attaches it by asset URL, and returns one row per file", async () => {
    const record = { create: [] as any[] };
    const seen: string[] = [];
    const res = await attachFiles(uploadingClient(record), "TES-1", [png, txt], {
      onAttached: (a) => seen.push(a.filename),
    });
    expect(calls).toEqual([
      "fileUpload shot.png image/png " + PNG.length + " public=false",
      "PUT https://storage.googleapis.com/b/1",
      "createAttachment shot.png",
      "fileUpload notes.txt text/plain 5 public=false",
      "PUT https://storage.googleapis.com/b/2",
      "createAttachment notes.txt",
    ]);
    expect(record.create).toEqual([
      { issueId: "issue-1", url: "https://uploads.linear.app/ws/1", title: "shot.png" },
      { issueId: "issue-1", url: "https://uploads.linear.app/ws/2", title: "notes.txt" },
    ]);
    expect(res.issue.identifier).toBe("TES-1");
    expect(res.attachments).toEqual([
      {
        id: "att-1",
        title: "shot.png",
        url: "https://uploads.linear.app/ws/1",
        assetUrl: "https://uploads.linear.app/ws/1",
        contentType: "image/png",
        size: PNG.length,
        filename: "shot.png",
        public: false,
      },
      {
        id: "att-2",
        title: "notes.txt",
        url: "https://uploads.linear.app/ws/2",
        assetUrl: "https://uploads.linear.app/ws/2",
        contentType: "text/plain",
        size: 5,
        filename: "notes.txt",
        public: false,
      },
    ]);
    expect(res.comment).toBeUndefined();
    // The progress callback fires as each file lands, in order.
    expect(seen).toEqual(["shot.png", "notes.txt"]);
  });

  it("validates the whole batch first: a missing third file means nothing is uploaded", async () => {
    await expect(
      attachFiles(uploadingClient(), "TES-1", [png, txt, join(dir, "nope.pdf")], {}),
    ).rejects.toMatchObject({ code: "usage" });
    expect(calls).toEqual([]);
  });

  it("--public on a non-image in the batch is refused before anything is uploaded", async () => {
    await expect(
      attachFiles(uploadingClient(), "TES-1", [png, txt], { public: true }),
    ).rejects.toMatchObject({
      code: "usage",
    });
    expect(calls).toEqual([]);
  });

  it("--public uploads publicly and says so on the row", async () => {
    const res = await attachFiles(uploadingClient(), "TES-1", [png], { public: true });
    expect(calls[0]).toContain("public=true");
    expect(res.attachments[0]!.public).toBe(true);
  });

  it("--title names a single attachment; with several files it is a usage error", async () => {
    const record = { create: [] as any[] };
    await attachFiles(uploadingClient(record), "TES-1", [png], { title: "Screenshot" });
    expect(record.create[0]!.title).toBe("Screenshot");
    await expect(
      attachFiles(uploadingClient(), "TES-1", [png, txt], { title: "x" }),
    ).rejects.toMatchObject({
      code: "usage",
    });
  });

  it("--comment posts ONE comment embedding every file — image inline, the rest as links", async () => {
    const record = { create: [] as any[], comment: undefined as any };
    const res = await attachFiles(uploadingClient(record), "TES-1", [png, txt], {
      comment: "See attached",
    });
    expect(record.comment).toEqual({
      issueId: "issue-1",
      body: "See attached\n\n![shot.png](https://uploads.linear.app/ws/1)\n[notes.txt](https://uploads.linear.app/ws/2)",
    });
    expect(res.comment).toEqual({ id: "cm-1", url: "https://linear.app/c/1" });
    // The comment comes after every attachment exists.
    expect(calls.at(-1)).toBe("createComment");
  });

  it("a refused fileUpload stops the batch: no PUT, no attachment", async () => {
    const client = uploadingClient();
    client.fileUpload = async () => ({ success: false, lastSyncId: 1, uploadFile: null });
    await expect(attachFiles(client, "TES-1", [png, txt], {})).rejects.toMatchObject({
      code: "api",
    });
    expect(calls).toEqual([]);
  });
});
