/**
 * `linear issue attach <issue> <file...>` and `comment add --attach <file>`
 * (also `issue comment add`) through the real program (TES-602). The API is a
 * fake client hung off Context and a fake `fetch` for the storage PUT; nothing
 * leaves the machine.
 *
 * Pinned here: the JSON contract (a bare array of `{id, title, url, assetUrl,
 * contentType, size}` for `issue attach`; the comment receipt for `comment
 * add`), the human receipts, that `--public` warns on stderr and is a usage
 * error for a non-image, that a batch is validated before any upload, and that
 * the signed URL never reaches stdout or stderr.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { connection, payload } from "./_fakes.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const SIGNED = "https://storage.googleapis.com/b/o?X-Goog-Signature=deadbeefcafe";

let dir: string;
let png: string;
let txt: string;
let savedEnv: Record<string, string | undefined>;
let savedFetch: typeof fetch;
let clientDescriptor: PropertyDescriptor | undefined;
let stdinTTY: unknown;
let stdoutTTY: unknown;

/** What the fakes saw. */
let calls: string[];
let attachmentsCreated: any[];
let commentsCreated: any[];
let out: string;
let err: string;

function fakeClient() {
  const issue = { id: "issue-1", identifier: "TES-1", title: "x" };
  let n = 0;
  return {
    issues: async () => connection([issue]),
    fileUpload: async (contentType: string, filename: string, size: number, vars: any) => {
      calls.push(`fileUpload ${filename} public=${vars.makePublic}`);
      n++;
      return payload("uploadFile", {
        assetUrl: `https://uploads.linear.app/ws/${n}`,
        uploadUrl: SIGNED,
        contentType,
        filename,
        size,
        headers: [{ key: "x-goog-content-length-range", value: `${size},${size}` }],
      });
    },
    createAttachment: async (input: any) => {
      calls.push(`createAttachment ${input.title}`);
      attachmentsCreated.push(input);
      return payload("attachment", {
        id: `att-${attachmentsCreated.length}`,
        title: input.title,
        url: input.url,
      });
    },
    createComment: async (input: any) => {
      calls.push("createComment");
      commentsCreated.push(input);
      return payload("comment", { id: "cm-1", url: "https://linear.app/c/1" });
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "linattachcmd-"));
  png = join(dir, "shot.png");
  txt = join(dir, "notes.txt");
  writeFileSync(png, PNG);
  writeFileSync(txt, "hello");
  savedEnv = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    HOME: process.env.HOME,
    LINEAR_API_KEY: process.env.LINEAR_API_KEY,
    EDITOR: process.env.EDITOR,
    VISUAL: process.env.VISUAL,
  };
  process.env.XDG_CONFIG_HOME = join(dir, "xdg");
  process.env.HOME = dir;
  process.env.LINEAR_API_KEY = "lin_api_test000000000000";
  // An editor that would be a loud failure if it ever opened.
  process.env.EDITOR = "false";
  delete process.env.VISUAL;
  calls = [];
  attachmentsCreated = [];
  commentsCreated = [];
  out = "";
  err = "";
  clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
  Object.defineProperty(Context.prototype, "client", {
    get: () => fakeClient(),
    configurable: true,
  });
  savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push(`PUT ${String(url).split("?")[0]} ${init?.method}`);
    return new Response("", { status: 200 });
  }) as typeof fetch;
  stdinTTY = (process.stdin as any).isTTY;
  stdoutTTY = (process.stdout as any).isTTY;
  vi.spyOn(process.stdout, "write").mockImplementation((c: any) => ((out += c), true));
  vi.spyOn(process.stderr, "write").mockImplementation((c: any) => ((err += c), true));
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = savedFetch;
  if (clientDescriptor) Object.defineProperty(Context.prototype, "client", clientDescriptor);
  (process.stdin as any).isTTY = stdinTTY;
  (process.stdout as any).isTTY = stdoutTTY;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

const run = (args: string[]) => createProgram().parseAsync(["node", "linear", ...args]);

describe("issue attach", () => {
  it("--json → a bare array of {id, title, url, assetUrl, contentType, size}, one per file", async () => {
    await run(["issue", "attach", "TES-1", png, txt, "--json"]);
    expect(JSON.parse(out)).toEqual([
      {
        id: "att-1",
        title: "shot.png",
        url: "https://uploads.linear.app/ws/1",
        assetUrl: "https://uploads.linear.app/ws/1",
        contentType: "image/png",
        size: PNG.length,
      },
      {
        id: "att-2",
        title: "notes.txt",
        url: "https://uploads.linear.app/ws/2",
        assetUrl: "https://uploads.linear.app/ws/2",
        contentType: "text/plain",
        size: 5,
      },
    ]);
    expect(calls).toEqual([
      "fileUpload shot.png public=false",
      "PUT https://storage.googleapis.com/b/o PUT",
      "createAttachment shot.png",
      "fileUpload notes.txt public=false",
      "PUT https://storage.googleapis.com/b/o PUT",
      "createAttachment notes.txt",
    ]);
    // Private by default: nothing on stderr about a public URL, and never the signed URL anywhere.
    expect(err).not.toMatch(/public/i);
    expect(out + err).not.toContain("deadbeefcafe");
  });

  it("human → one receipt per file, with the size", async () => {
    await run(["issue", "attach", "TES-1", png, txt]);
    expect(err).toContain(`Attached shot.png (${PNG.length} B) to TES-1`);
    expect(err).toContain("Attached notes.txt (5 B) to TES-1");
    expect(out).toBe("");
  });

  it("--title names the single attachment", async () => {
    await run(["issue", "attach", "TES-1", png, "--title", "The screenshot", "--json"]);
    expect(attachmentsCreated[0]!.title).toBe("The screenshot");
    expect(JSON.parse(out)[0].title).toBe("The screenshot");
  });

  it("--title with several files is a usage error before anything is uploaded", async () => {
    await expect(
      run(["issue", "attach", "TES-1", png, txt, "--title", "x", "--json"]),
    ).rejects.toMatchObject({
      code: "usage",
    });
    expect(calls).toEqual([]);
  });

  it("--comment posts one comment embedding every file, and the JSON row carries it", async () => {
    await run(["issue", "attach", "TES-1", png, txt, "--comment", "Repro", "--json"]);
    expect(commentsCreated).toEqual([
      {
        issueId: "issue-1",
        body: "Repro\n\n![shot.png](https://uploads.linear.app/ws/1)\n[notes.txt](https://uploads.linear.app/ws/2)",
      },
    ]);
    const rows = JSON.parse(out);
    expect(rows[0].comment).toEqual({ id: "cm-1", url: "https://linear.app/c/1" });
    expect(rows[1].comment).toEqual({ id: "cm-1", url: "https://linear.app/c/1" });
    // Human mode says so too.
    out = "";
    err = "";
    await run(["issue", "attach", "TES-1", png, "--comment", "Repro"]);
    expect(err).toContain("Commented on TES-1");
  });

  it("without --comment, the JSON rows carry no comment key", async () => {
    await run(["issue", "attach", "TES-1", png, "--json"]);
    expect(Object.keys(JSON.parse(out)[0])).toEqual([
      "id",
      "title",
      "url",
      "assetUrl",
      "contentType",
      "size",
    ]);
  });

  it("--public uploads publicly and warns on stderr that the URL is world-readable", async () => {
    await run(["issue", "attach", "TES-1", png, "--public", "--json"]);
    expect(calls[0]).toBe("fileUpload shot.png public=true");
    expect(err).toMatch(/public/i);
    expect(err).toMatch(/anyone|world-readable/i);
    expect(err).toContain("https://uploads.linear.app/ws/1");
    // The JSON on stdout is untouched by the warning.
    expect(JSON.parse(out)).toHaveLength(1);
  });

  it("--public on a non-image is a usage error and nothing is uploaded — even mid-batch", async () => {
    await expect(
      run(["issue", "attach", "TES-1", png, txt, "--public", "--json"]),
    ).rejects.toMatchObject({
      code: "usage",
    });
    expect(calls).toEqual([]);
  });

  it("a missing file anywhere in the batch fails before anything is uploaded", async () => {
    await expect(
      run(["issue", "attach", "TES-1", png, join(dir, "nope.txt"), "--json"]),
    ).rejects.toMatchObject({ code: "usage" });
    expect(calls).toEqual([]);
  });

  it("an image attached without --comment gets a hint that the sidebar does not render it inline", async () => {
    await run(["issue", "attach", "TES-1", png]);
    expect(err).toMatch(/inline/i);
    expect(err).toContain("--attach");
    // Not for a text file, and not when --comment already embeds it.
    err = "";
    await run(["issue", "attach", "TES-1", txt]);
    expect(err).not.toMatch(/inline/i);
    err = "";
    await run(["issue", "attach", "TES-1", png, "--comment", "here"]);
    expect(err).not.toMatch(/inline/i);
  });

  it("is a real subcommand: `issue attach x` no longer lands in view with a pointer", async () => {
    await expect(run(["issue", "attach", "TES-1", "--json"])).rejects.toThrow(
      /missing required argument 'file'/i,
    );
  });
});

describe("comment add --attach", () => {
  it("uploads and appends the embeds to the body; the receipt lists the attachments", async () => {
    await run(["comment", "add", "TES-1", "Look:", "--attach", png, "--attach", txt, "--json"]);
    expect(commentsCreated).toEqual([
      {
        issueId: "issue-1",
        body: "Look:\n\n![shot.png](https://uploads.linear.app/ws/1)\n[notes.txt](https://uploads.linear.app/ws/2)",
      },
    ]);
    expect(JSON.parse(out)).toEqual({
      id: "cm-1",
      issue: "TES-1",
      url: "https://linear.app/c/1",
      attachments: [
        {
          filename: "shot.png",
          assetUrl: "https://uploads.linear.app/ws/1",
          contentType: "image/png",
          size: PNG.length,
        },
        {
          filename: "notes.txt",
          assetUrl: "https://uploads.linear.app/ws/2",
          contentType: "text/plain",
          size: 5,
        },
      ],
    });
    expect(out + err).not.toContain("deadbeefcafe");
  });

  it("without --attach the receipt is unchanged (no attachments key)", async () => {
    await run(["comment", "add", "TES-1", "plain", "--json"]);
    expect(JSON.parse(out)).toEqual({ id: "cm-1", issue: "TES-1", url: "https://linear.app/c/1" });
  });

  it("the same flag works under `issue comment add`", async () => {
    await run(["issue", "comment", "add", "TES-1", "Look:", "--attach", png, "--json"]);
    expect(commentsCreated[0]!.body).toBe("Look:\n\n![shot.png](https://uploads.linear.app/ws/1)");
  });

  it("an attachment with no body posts just the embed — and does not open the editor", async () => {
    // Interactive, so the editor path WOULD be taken for a bodiless comment.
    (process.stdin as any).isTTY = true;
    (process.stdout as any).isTTY = true;
    await run(["comment", "add", "TES-1", "--attach", png]);
    expect(commentsCreated[0]!.body).toBe("![shot.png](https://uploads.linear.app/ws/1)");
    expect(err).toContain("Commented on TES-1");
  });

  it("no body and no attachment is still a usage error", async () => {
    await expect(run(["comment", "add", "TES-1", "--json"])).rejects.toMatchObject({
      code: "usage",
    });
    expect(calls).toEqual([]);
  });

  it("--public without --attach is a usage error", async () => {
    await expect(
      run(["comment", "add", "TES-1", "hi", "--public", "--json"]),
    ).rejects.toMatchObject({
      code: "usage",
    });
    expect(calls).toEqual([]);
  });

  it("--public warns per public upload; on a non-image it is a usage error before any upload", async () => {
    await run(["comment", "add", "TES-1", "hi", "--attach", png, "--public", "--json"]);
    expect(calls[0]).toBe("fileUpload shot.png public=true");
    expect(err).toMatch(/anyone|world-readable/i);
    calls = [];
    await expect(
      run([
        "comment",
        "add",
        "TES-1",
        "hi",
        "--attach",
        png,
        "--attach",
        txt,
        "--public",
        "--json",
      ]),
    ).rejects.toMatchObject({ code: "usage" });
    expect(calls).toEqual([]);
  });

  it("a missing --attach file fails before anything is uploaded", async () => {
    await expect(
      run([
        "comment",
        "add",
        "TES-1",
        "hi",
        "--attach",
        png,
        "--attach",
        join(dir, "nope.txt"),
        "--json",
      ]),
    ).rejects.toMatchObject({ code: "usage" });
    expect(calls).toEqual([]);
    expect(commentsCreated).toEqual([]);
  });
});
