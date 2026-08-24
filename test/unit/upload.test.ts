/**
 * `src/lib/upload.ts` — the two-step upload behind `issue attach` and
 * `comment add --attach` (TES-602), driven against a fake client and a
 * recording `fetch`, so nothing leaves the machine.
 *
 * What is pinned here and why:
 *  - the PUT carries **exactly** the headers Linear returned, plus the
 *    Content-Type the signed URL was issued for — a wrong or missing header is
 *    a 403 from the storage backend, and the body is the file's bytes;
 *  - the signed `uploadUrl` is a bearer credential: it never appears in an
 *    error, whatever the storage backend or the transport echoed back;
 *  - private by default, `--public` only for raster images (schpet's rule,
 *    and the API's: "Public uploads are only supported for images (excluding
 *    SVG)"), decided BEFORE any network work;
 *  - a batch is validated up front, so a typo in file 3 does not leave files
 *    1–2 uploaded and orphaned.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mimeType,
  isImage,
  validateUploads,
  uploadFile,
  formatEmbed,
  formatBytes,
} from "../../src/lib/upload.js";
import { payload, failedPayload } from "./_fakes.js";

const UPLOAD_URL =
  "https://storage.googleapis.com/bucket/obj?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=deadbeefcafe";
const ASSET_URL = "https://uploads.linear.app/ws/obj";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let dir: string;
let png: string;
let txt: string;

/** What the fake client and fetch saw. */
let uploadCalls: Array<{ contentType: string; filename: string; size: number; vars: any }>;
let puts: Array<{ url: string; method: string; headers: Headers; body: Uint8Array }>;

/** A client whose `fileUpload` answers a signed URL with two headers, as Linear does. */
function fakeClient(answer?: (args: any) => any) {
  return {
    fileUpload: async (contentType: string, filename: string, size: number, vars: any) => {
      uploadCalls.push({ contentType, filename, size, vars });
      if (answer) return answer({ contentType, filename, size, vars });
      return payload("uploadFile", {
        assetUrl: ASSET_URL,
        uploadUrl: UPLOAD_URL,
        contentType,
        filename,
        size,
        headers: [
          { key: "x-goog-content-length-range", value: `${size},${size}` },
          { key: "Content-Disposition", value: `attachment; filename="${filename}"` },
        ],
      });
    },
  } as any;
}

/** A `fetch` that records the PUT and answers `status`. */
function recordingFetch(status = 200, bodyText = ""): typeof fetch {
  return (async (url: any, init: any) => {
    const body = init?.body;
    puts.push({
      url: String(url),
      method: init?.method,
      headers: new Headers(init?.headers),
      body:
        body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer()),
    });
    return new Response(bodyText, { status, statusText: status === 200 ? "OK" : "Forbidden" });
  }) as typeof fetch;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "linupload-"));
  png = join(dir, "shot.png");
  txt = join(dir, "notes.txt");
  writeFileSync(png, PNG);
  writeFileSync(txt, "hello");
  uploadCalls = [];
  puts = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("mimeType", () => {
  it("knows the common extensions, case-insensitively", () => {
    expect(mimeType("a.png")).toBe("image/png");
    expect(mimeType("a.JPG")).toBe("image/jpeg");
    expect(mimeType("a.jpeg")).toBe("image/jpeg");
    expect(mimeType("a.gif")).toBe("image/gif");
    expect(mimeType("a.webp")).toBe("image/webp");
    expect(mimeType("a.svg")).toBe("image/svg+xml");
    expect(mimeType("a.pdf")).toBe("application/pdf");
    expect(mimeType("a.txt")).toBe("text/plain");
    expect(mimeType("a.md")).toBe("text/markdown");
    expect(mimeType("a.csv")).toBe("text/csv");
    expect(mimeType("a.json")).toBe("application/json");
    expect(mimeType("a.zip")).toBe("application/zip");
    expect(mimeType("a.mp4")).toBe("video/mp4");
    expect(mimeType("a.log")).toBe("text/plain");
  });
  it("falls back to application/octet-stream", () => {
    expect(mimeType("a.xyz")).toBe("application/octet-stream");
    expect(mimeType("Makefile")).toBe("application/octet-stream");
  });
  it("isImage is the image/* family", () => {
    expect(isImage("image/png")).toBe(true);
    expect(isImage("image/svg+xml")).toBe(true);
    expect(isImage("text/plain")).toBe(false);
  });
});

describe("validateUploads — the whole batch, before any network work", () => {
  it("returns a candidate per file with name, type and size", () => {
    const [a, b] = validateUploads([png, txt]);
    expect(a).toEqual({
      path: png,
      filename: "shot.png",
      contentType: "image/png",
      size: PNG.length,
    });
    expect(b).toEqual({ path: txt, filename: "notes.txt", contentType: "text/plain", size: 5 });
  });

  it("a missing file anywhere in the batch is a usage error naming it", () => {
    const missing = join(dir, "nope.png");
    expect(() => validateUploads([png, txt, missing])).toThrow(/nope\.png/);
    expect(() => validateUploads([png, txt, missing])).toThrow(
      expect.objectContaining({ code: "usage", exitCode: 2 }),
    );
  });

  it("a directory is not a file", () => {
    const d = join(dir, "sub");
    mkdirSync(d);
    expect(() => validateUploads([d])).toThrow(/not a (regular )?file/i);
  });

  it("an unreadable file is refused up front", () => {
    if (process.getuid?.() === 0) return; // root reads anything
    const locked = join(dir, "locked.txt");
    writeFileSync(locked, "x");
    chmodSync(locked, 0o000);
    try {
      expect(() => validateUploads([png, locked])).toThrow(/locked\.txt/);
    } finally {
      chmodSync(locked, 0o600);
    }
  });

  it("--public on a non-image is a usage error, even in a mixed batch", () => {
    expect(() => validateUploads([png, txt], { public: true })).toThrow(/public/i);
    expect(() => validateUploads([png, txt], { public: true })).toThrow(
      expect.objectContaining({ code: "usage" }),
    );
    // SVG is an image type but not a raster one — the API refuses it too.
    const svg = join(dir, "d.svg");
    writeFileSync(svg, "<svg/>");
    expect(() => validateUploads([svg], { public: true })).toThrow(/public/i);
    // Raster images are fine.
    expect(() => validateUploads([png], { public: true })).not.toThrow();
  });
});

describe("uploadFile", () => {
  it("asks for a signed URL with the file's type/name/size, private by default", async () => {
    await uploadFile(fakeClient(), png, { fetch: recordingFetch() });
    expect(uploadCalls).toEqual([
      {
        contentType: "image/png",
        filename: "shot.png",
        size: PNG.length,
        vars: { makePublic: false },
      },
    ]);
  });

  it("PUTs the file's bytes to the signed URL with exactly the returned headers (+ Content-Type)", async () => {
    const result = await uploadFile(fakeClient(), png, { fetch: recordingFetch() });
    expect(puts).toHaveLength(1);
    const put = puts[0]!;
    expect(put.url).toBe(UPLOAD_URL);
    expect(put.method).toBe("PUT");
    expect(Buffer.from(put.body).equals(PNG)).toBe(true);
    // The two headers Linear returned, verbatim …
    expect(put.headers.get("x-goog-content-length-range")).toBe(`${PNG.length},${PNG.length}`);
    expect(put.headers.get("content-disposition")).toBe('attachment; filename="shot.png"');
    // … plus the Content-Type the URL was signed for (it is in X-Goog-SignedHeaders
    // but not in the returned array), and nothing else of ours.
    expect(put.headers.get("content-type")).toBe("image/png");
    expect([...put.headers.keys()].sort()).toEqual([
      "content-disposition",
      "content-type",
      "x-goog-content-length-range",
    ]);
    expect(result).toEqual({
      assetUrl: ASSET_URL,
      filename: "shot.png",
      contentType: "image/png",
      size: PNG.length,
      public: false,
    });
  });

  it("a returned header wins over the default Content-Type, whatever its case", async () => {
    const client = fakeClient(({ contentType, filename, size }) =>
      payload("uploadFile", {
        assetUrl: ASSET_URL,
        uploadUrl: UPLOAD_URL,
        contentType,
        filename,
        size,
        headers: [{ key: "Content-Type", value: "application/x-custom" }],
      }),
    );
    await uploadFile(client, png, { fetch: recordingFetch() });
    // One content-type, the returned one — not "image/png, application/x-custom".
    expect(puts[0]!.headers.get("content-type")).toBe("application/x-custom");
  });

  it("--public sends makePublic: true and reports it", async () => {
    const result = await uploadFile(fakeClient(), png, { public: true, fetch: recordingFetch() });
    expect(uploadCalls[0]!.vars).toEqual({ makePublic: true });
    expect(result.public).toBe(true);
  });

  it("--public on a non-image is a usage error and nothing is sent", async () => {
    await expect(
      uploadFile(fakeClient(), txt, { public: true, fetch: recordingFetch() }),
    ).rejects.toMatchObject({
      code: "usage",
    });
    expect(uploadCalls).toEqual([]);
    expect(puts).toEqual([]);
  });

  it("a missing file is a usage error and nothing is sent", async () => {
    await expect(
      uploadFile(fakeClient(), join(dir, "nope.txt"), { fetch: recordingFetch() }),
    ).rejects.toMatchObject({ code: "usage" });
    expect(uploadCalls).toEqual([]);
  });

  it("success: false from fileUpload is an api error, and no PUT happens", async () => {
    const client = fakeClient(() => failedPayload("uploadFile"));
    await expect(uploadFile(client, png, { fetch: recordingFetch() })).rejects.toMatchObject({
      code: "api",
      exitCode: 1,
    });
    expect(puts).toEqual([]);
  });

  it("success without an uploadFile is an api error too", async () => {
    const client = fakeClient(() => ({ success: true, lastSyncId: 1, uploadFile: undefined }));
    await expect(uploadFile(client, png, { fetch: recordingFetch() })).rejects.toMatchObject({
      code: "api",
    });
    expect(puts).toEqual([]);
  });

  it("a non-2xx from storage is an api error that names the file and status — never the signed URL", async () => {
    const echo = `<Error><Code>SignatureDoesNotMatch</Code><StringToSign>PUT ${UPLOAD_URL}</StringToSign></Error>`;
    let err: any;
    try {
      await uploadFile(fakeClient(), png, { fetch: recordingFetch(403, echo) });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "api" });
    expect(err.message).toContain("shot.png");
    expect(err.message).toContain("403");
    expect(err.message).toContain("SignatureDoesNotMatch");
    expect(err.message).not.toContain(UPLOAD_URL);
    expect(err.message).not.toContain("deadbeefcafe");
    expect(err.message).not.toContain("X-Goog-Signature");
    expect(JSON.stringify(err.detail ?? null)).not.toContain("deadbeefcafe");
  });

  it("a transport failure during the PUT is redacted the same way", async () => {
    const failing = (async () => {
      throw new TypeError(`Unable to connect to ${UPLOAD_URL}`);
    }) as unknown as typeof fetch;
    let err: any;
    try {
      await uploadFile(fakeClient(), png, { fetch: failing });
    } catch (e) {
      err = e;
    }
    expect(err.message).toContain("shot.png");
    expect(err.message).not.toContain(UPLOAD_URL);
    expect(err.message).not.toContain("deadbeefcafe");
    expect(err.message).toContain("Unable to connect");
  });
});

describe("formatEmbed / formatBytes", () => {
  it("images embed inline, everything else links", () => {
    expect(
      formatEmbed({ filename: "a.png", assetUrl: "https://u/x", contentType: "image/png" }),
    ).toBe("![a.png](https://u/x)");
    expect(
      formatEmbed({ filename: "a.txt", assetUrl: "https://u/y", contentType: "text/plain" }),
    ).toBe("[a.txt](https://u/y)");
  });
  it("formatBytes is human-sized", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(70)).toBe("70 B");
    expect(formatBytes(12 * 1024)).toBe("12 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3 MB");
  });
});
