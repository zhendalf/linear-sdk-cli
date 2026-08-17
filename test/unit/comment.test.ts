import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listComments,
  addComment,
  replyToComment,
  updateComment,
  deleteComment,
  setResolved,
} from "../../src/services/comment.js";

/**
 * The comment service is a thin SDK passthrough, so these tests focus on its
 * branching logic: payload unwrapping, the reply -> parent -> issue chain, the
 * resolve/unresolve dispatch, and the list row shaping (author fallback).
 *
 * resolveIssue (used by listComments/addComment) goes through client.issue for a
 * UUID input, so we feed UUIDs to keep the mocked client minimal.
 */

const ISSUE_UUID = "01234567-89ab-cdef-0123-456789abcdef";

function issueModel(overrides: Record<string, any> = {}) {
  return {
    id: ISSUE_UUID,
    identifier: "TES-1",
    comments: vi.fn(),
    ...overrides,
  };
}

describe("listComments", () => {
  // The author is an OBJECT (id + displayName) like every other list row's
  // relations, and null for a deleted account — not a display string, and no
  // "unknown" placeholder that a script could mistake for a real name.
  it("maps rawRequest nodes to rows: author object, thread parent, edited/resolved", async () => {
    // listComments uses a tailored GraphQL query (no N+1) via client.client.rawRequest.
    const rawRequest = vi.fn().mockResolvedValue({
      data: {
        issue: {
          comments: {
            nodes: [
              { id: "c1", body: "hello\nworld", url: "u1", createdAt: "2026-01-02T03:04:05.000Z", editedAt: null, resolvedAt: null, parent: null, user: { id: "u-ada", displayName: "Ada" } },
              { id: "c2", body: "anon", url: "u2", createdAt: "2026-02-02T00:00:00.000Z", editedAt: "2026-02-03T00:00:00.000Z", resolvedAt: null, parent: { id: "c1" }, user: null },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    });
    const issue = issueModel();
    const client = { issue: vi.fn().mockResolvedValue(issue), client: { rawRequest } } as any;

    const rows = await listComments(client, ISSUE_UUID, 50);
    expect(rows).toEqual([
      { id: "c1", body: "hello\nworld", user: { id: "u-ada", displayName: "Ada" }, createdAt: "2026-01-02T03:04:05.000Z", editedAt: null, resolvedAt: null, parent: null, url: "u1" },
      { id: "c2", body: "anon", user: null, createdAt: "2026-02-02T00:00:00.000Z", editedAt: "2026-02-03T00:00:00.000Z", resolvedAt: null, parent: { id: "c1" }, url: "u2" },
    ]);
  });
});

describe("addComment", () => {
  it("creates a comment on the resolved issue and unwraps the payload", async () => {
    const issue = issueModel();
    const created = { id: "new", url: "url" };
    const createComment = vi.fn().mockResolvedValue({ success: true, comment: Promise.resolve(created) });
    const client = { issue: vi.fn().mockResolvedValue(issue), createComment } as any;

    const res = await addComment(client, ISSUE_UUID, "hi");
    expect(createComment).toHaveBeenCalledWith({ issueId: ISSUE_UUID, body: "hi" });
    expect(res.comment).toBe(created as any);
    expect(res.issue).toBe(issue as any);
  });

  it("fails when the payload carries no comment, rather than inventing one", async () => {
    const client = {
      issue: vi.fn().mockResolvedValue(issueModel()),
      createComment: vi.fn().mockResolvedValue({ success: true, comment: Promise.resolve(null) }),
    } as any;
    await expect(addComment(client, ISSUE_UUID, "hi")).rejects.toMatchObject({
      code: "api",
      exitCode: 1,
    });
  });

  /**
   * `--attach <file>` (TES-602): every file is validated, then uploaded, and
   * the markdown embeds are appended to the body — a blank line, then one per
   * line — before the one createComment. Images embed inline (`![]()`),
   * anything else links.
   */
  describe("with attachments", () => {
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
      dir = mkdtempSync(join(tmpdir(), "lincmatt-"));
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

    function client(createComment = vi.fn()) {
      let n = 0;
      createComment.mockResolvedValue({
        success: true,
        comment: Promise.resolve({ id: "new", url: "url" }),
      });
      return {
        issue: vi.fn().mockResolvedValue(issueModel()),
        fileUpload: async (contentType: string, filename: string, size: number, vars: any) => {
          calls.push(`fileUpload ${filename} public=${vars.makePublic}`);
          n++;
          return {
            success: true,
            lastSyncId: 1,
            uploadFile: {
              assetUrl: `https://uploads.linear.app/ws/${n}`,
              uploadUrl: `https://storage.googleapis.com/b/${n}?X-Goog-Signature=s`,
              headers: [],
            },
          };
        },
        createComment,
      } as any;
    }

    it("uploads, then appends the embeds to the body — image inline, text as a link", async () => {
      const createComment = vi.fn();
      const res = await addComment(client(createComment), ISSUE_UUID, "Look:", { attachments: [png, txt] });
      expect(createComment).toHaveBeenCalledWith({
        issueId: ISSUE_UUID,
        body: "Look:\n\n![shot.png](https://uploads.linear.app/ws/1)\n[notes.txt](https://uploads.linear.app/ws/2)",
      });
      expect(calls).toEqual([
        "fileUpload shot.png public=false",
        "PUT https://storage.googleapis.com/b/1",
        "fileUpload notes.txt public=false",
        "PUT https://storage.googleapis.com/b/2",
      ]);
      expect(res.uploads.map((u) => u.filename)).toEqual(["shot.png", "notes.txt"]);
    });

    it("an empty body with attachments is just the embeds", async () => {
      const createComment = vi.fn();
      await addComment(client(createComment), ISSUE_UUID, "", { attachments: [png] });
      expect(createComment).toHaveBeenCalledWith({
        issueId: ISSUE_UUID,
        body: "![shot.png](https://uploads.linear.app/ws/1)",
      });
    });

    it("validates every file before uploading any", async () => {
      const createComment = vi.fn();
      await expect(
        addComment(client(createComment), ISSUE_UUID, "x", { attachments: [png, join(dir, "nope.txt")] }),
      ).rejects.toMatchObject({ code: "usage" });
      expect(calls).toEqual([]);
      expect(createComment).not.toHaveBeenCalled();
    });

    it("--public on a non-image is refused before anything is uploaded", async () => {
      const createComment = vi.fn();
      await expect(
        addComment(client(createComment), ISSUE_UUID, "x", { attachments: [txt], public: true }),
      ).rejects.toMatchObject({ code: "usage" });
      expect(calls).toEqual([]);
    });

    it("--public is passed through and reported on the uploads", async () => {
      const res = await addComment(client(), ISSUE_UUID, "x", { attachments: [png], public: true });
      expect(calls[0]).toBe("fileUpload shot.png public=true");
      expect(res.uploads[0]!.public).toBe(true);
    });

    it("no attachments: the plain path is unchanged, and uploads is empty", async () => {
      const createComment = vi.fn();
      const res = await addComment(client(createComment), ISSUE_UUID, "hi", {});
      expect(createComment).toHaveBeenCalledWith({ issueId: ISSUE_UUID, body: "hi" });
      expect(res.uploads).toEqual([]);
    });
  });
});

describe("replyToComment", () => {
  // The parent is looked up via rawRequest (the typed client.comment getter is
  // broken in @linear/sdk v87), so we mock client.client.rawRequest.
  function clientWithParent(commentNode: any, createComment = vi.fn()) {
    return {
      client: { rawRequest: vi.fn().mockResolvedValue({ data: { comment: commentNode } }) },
      createComment,
    } as any;
  }

  it("nests under the parent via parentId + issueId and surfaces the parent's issue", async () => {
    const parentIssue = { id: "issue-id", identifier: "TES-9" };
    const node = { id: "parent-id", issueId: "issue-id", issue: parentIssue };
    const created = { id: "reply-id", url: "url" };
    const createComment = vi.fn().mockResolvedValue({ success: true, comment: Promise.resolve(created) });
    const client = clientWithParent(node, createComment);

    const res = await replyToComment(client, "parent-id", "re");
    expect(createComment).toHaveBeenCalledWith({
      parentId: "parent-id",
      issueId: "issue-id",
      body: "re",
    });
    expect(res.comment).toBe(created as any);
    expect(res.issue).toBe(parentIssue);
  });

  it("throws not_found when the parent comment does not exist", async () => {
    const client = clientWithParent(null);
    await expect(replyToComment(client, "missing", "x")).rejects.toMatchObject({ code: "not_found" });
  });

  it("throws a usage error when the parent has no owning issue", async () => {
    const client = clientWithParent({ id: "p", issueId: null, issue: null });
    await expect(replyToComment(client, "p", "x")).rejects.toMatchObject({ code: "usage" });
  });
});

describe("updateComment", () => {
  it("passes a body-only update input and unwraps the payload", async () => {
    const updated = { id: "c1", url: "u" };
    const updateCommentFn = vi.fn().mockResolvedValue({ success: true, comment: Promise.resolve(updated) });
    const client = { updateComment: updateCommentFn } as any;

    const res = await updateComment(client, "c1", "new body");
    expect(updateCommentFn).toHaveBeenCalledWith("c1", { body: "new body" });
    expect(res).toBe(updated as any);
  });
});

describe("deleteComment", () => {
  it("deletes by id and echoes the id back", async () => {
    const deleteCommentFn = vi.fn().mockResolvedValue({ success: true });
    const client = { deleteComment: deleteCommentFn } as any;

    const res = await deleteComment(client, "c1");
    expect(deleteCommentFn).toHaveBeenCalledWith("c1");
    expect(res).toEqual({ id: "c1" });
  });

  it("fails when the API reports success: false", async () => {
    const client = { deleteComment: vi.fn().mockResolvedValue({ success: false }) } as any;
    await expect(deleteComment(client, "c1")).rejects.toMatchObject({ code: "api", exitCode: 1 });
  });
});

describe("setResolved", () => {
  it("dispatches to commentResolve when resolving", async () => {
    const resolved = { id: "c1" };
    const commentResolve = vi.fn().mockResolvedValue({ success: true, comment: Promise.resolve(resolved) });
    const commentUnresolve = vi.fn();
    const client = { commentResolve, commentUnresolve } as any;

    const res = await setResolved(client, "c1", true);
    expect(commentResolve).toHaveBeenCalledWith("c1");
    expect(commentUnresolve).not.toHaveBeenCalled();
    expect(res).toBe(resolved as any);
  });

  it("dispatches to commentUnresolve when unresolving", async () => {
    const unresolved = { id: "c1" };
    const commentResolve = vi.fn();
    const commentUnresolve = vi.fn().mockResolvedValue({ success: true, comment: Promise.resolve(unresolved) });
    const client = { commentResolve, commentUnresolve } as any;

    const res = await setResolved(client, "c1", false);
    expect(commentUnresolve).toHaveBeenCalledWith("c1");
    expect(commentResolve).not.toHaveBeenCalled();
    expect(res).toBe(unresolved as any);
  });
});
