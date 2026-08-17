/**
 * File upload — the two-step flow behind `issue attach` and `comment add
 * --attach` (TES-602).
 *
 *   1. `fileUpload(contentType, filename, size, { makePublic })` asks Linear for
 *      a signed storage URL. The payload is `{ success, uploadFile }`, checked
 *      like every other mutation (`unwrapMutation`): `success: false` or a
 *      missing `uploadFile` is a refusal, not a URL.
 *   2. HTTP `PUT` the bytes to `uploadFile.uploadUrl` with the
 *      `uploadFile.headers[]` Linear returned, verbatim, plus the Content-Type
 *      the URL was signed for. The URL is signed over `content-type;host;
 *      x-goog-content-length-range` (probed on the QA workspace, SDK 89), so a
 *      wrong or missing header is a 403 from the storage backend, not from
 *      Linear — and the returned array does not include Content-Type itself,
 *      which is why it is set here from the type we declared in step 1. Linear's
 *      own upload guide does the same.
 *
 * The signed `uploadUrl` is a bearer credential (anyone holding it can write
 * that object for the next 60 s). It is never logged, never returned, and is
 * redacted from any error text — the storage backend echoes it in
 * `SignatureDoesNotMatch` bodies, and a transport error can carry it too.
 *
 * Privacy posture, matching schpet/linear-cli 2.5 and the Linear web app:
 * uploads are private (workspace members only, `uploads.linear.app`) unless
 * `public` is asked for; a public upload lands on `public.linear.app`, readable
 * by anyone with the URL, and is only valid for raster images — Linear itself
 * answers "Public uploads are only supported for images (excluding SVG)" to
 * anything else. That rule is enforced here BEFORE any network work, so a
 * mixed batch cannot publish some files and then fail on the rest.
 */

import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { CliError, usageError } from "./errors.js";
import { unwrapMutation } from "./mutation.js";

/** MIME type by extension. Anything else is `application/octet-stream`. */
const MIME_TYPES: Record<string, string> = {
  // images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".ico": "image/x-icon",
  ".heic": "image/heic",
  ".avif": "image/avif",
  // documents
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // text
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".xml": "text/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/toml",
  ".json": "application/json",
  // code
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".jsx": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".sh": "text/x-shellscript",
  ".bash": "text/x-shellscript",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".java": "text/x-java",
  ".c": "text/x-c",
  ".h": "text/x-c",
  ".cpp": "text/x-c++",
  ".hpp": "text/x-c++",
  ".swift": "text/x-swift",
  ".kt": "text/x-kotlin",
  // archives
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".tgz": "application/gzip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  // audio / video
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  // other
  ".wasm": "application/wasm",
};

/**
 * The content types Linear will serve from a public URL: raster images only.
 * SVG is an image but can carry script, and the API refuses it publicly.
 */
const PUBLIC_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/heic",
  "image/avif",
]);

/** MIME type from the file's extension; `application/octet-stream` when unknown. */
export function mimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** `image/*` — what renders inline in a comment as `![name](url)`. */
export function isImage(contentType: string): boolean {
  return contentType.startsWith("image/");
}

/** Whether Linear allows this content type on a public URL. */
export function canBePublic(contentType: string): boolean {
  return PUBLIC_TYPES.has(contentType);
}

export interface UploadOptions {
  /**
   * Upload to a public, unauthenticated URL. Off by default (private —
   * workspace members only), and only valid for raster images.
   */
  public?: boolean;
  /** The `fetch` to PUT with; injectable for tests. Defaults to the global. */
  fetch?: typeof fetch;
}

/** A file that passed `validateUploads`: what will be declared to `fileUpload`. */
export interface UploadCandidate {
  path: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface UploadResult {
  /** The permanent URL Linear serves the file from (private unless `public`). */
  assetUrl: string;
  filename: string;
  contentType: string;
  size: number;
  /** Whether the file went to a public, world-readable URL. */
  public: boolean;
}

/**
 * Check every path BEFORE any network work: it exists, is a regular file, is
 * readable, and — with `public` — is a type Linear will serve publicly. Called
 * on the whole batch up front so a typo in file 3 does not leave files 1–2
 * uploaded and orphaned, and so a mixed `--public` batch is refused whole
 * rather than half-published. Returns what each upload will declare.
 */
export function validateUploads(paths: string[], opts: UploadOptions = {}): UploadCandidate[] {
  return paths.map((path) => {
    let size: number;
    try {
      const st = statSync(path);
      if (!st.isFile()) throw usageError(`'${path}' is not a regular file.`);
      size = st.size;
      accessSync(path, constants.R_OK);
    } catch (err) {
      if (err instanceof CliError) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw usageError(`File not found: '${path}'.`);
      if (code === "EACCES") throw usageError(`Cannot read '${path}': permission denied.`);
      throw usageError(`Cannot read '${path}': ${(err as Error).message}`);
    }
    const contentType = mimeType(path);
    if (opts.public && !canBePublic(contentType)) {
      throw usageError(
        `Cannot upload '${basename(path)}' (${contentType}) to a public URL: Linear only serves raster ` +
          "images (png, jpeg, gif, webp, bmp, tiff) publicly. Drop --public to upload it privately.",
      );
    }
    return { path, filename: basename(path), contentType, size };
  });
}

/**
 * Upload one file: signed URL from Linear, then PUT the bytes to it. Private
 * unless `opts.public`. Throws a usage error before any network work when the
 * file is missing/unreadable or `public` is asked for a non-image.
 */
export async function uploadFile(
  client: LinearClient,
  path: string,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const [file] = validateUploads([path], opts);
  const { filename, contentType, size } = file!;
  const makePublic = opts.public === true;

  // Read the bytes before asking for the URL: it is only valid for ~60 s, and
  // a slow disk should not eat into that.
  const bytes = readFileSync(path);

  const upload = await unwrapMutation(
    withRetry(() => client.fileUpload(contentType, filename, size, { makePublic })),
    "uploadFile",
    `Upload of ${filename}`,
  );
  const uploadUrl: string = upload.uploadUrl;

  // Content-Type first (the URL is signed over it), then Linear's headers
  // verbatim — through `Headers.set`, so a returned Content-Type replaces the
  // default rather than being appended to it as a second value.
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  for (const h of upload.headers ?? []) headers.set(h.key, h.value);

  const doFetch = opts.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(uploadUrl, { method: "PUT", headers, body: bytes });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new CliError(`Upload of ${filename} failed: ${redact(why, uploadUrl)}`, "network");
  }
  if (!response.ok) {
    const text = redact(await response.text().catch(() => ""), uploadUrl);
    const why = storageErrorSummary(text);
    throw new CliError(
      `Upload of ${filename} failed: storage returned ${response.status} ${response.statusText}${why ? `: ${why}` : ""}`,
      "api",
      { status: response.status, statusText: response.statusText, body: text.slice(0, 2000) },
    );
  }

  return { assetUrl: upload.assetUrl, filename, contentType, size, public: makePublic };
}

/**
 * One line from a storage error body (already redacted). GCS answers in XML —
 * `<Code>SignatureDoesNotMatch</Code><Message>…</Message><Details>…</Details>`
 * followed by the whole canonical request — so pick the code and the most
 * specific sentence; anything else is collapsed and cut short.
 */
function storageErrorSummary(text: string): string {
  const tag = (name: string) => text.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim();
  const code = tag("Code");
  if (code) {
    const why = tag("Details") || tag("Message");
    return why ? `${code} — ${why}` : code;
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Strip the signed URL from text that may echo it: the whole URL, its query
 * string on its own, and any `…Signature=<hex>` parameter, however the
 * backend or transport spelled it.
 */
function redact(text: string, uploadUrl: string): string {
  let out = text.split(uploadUrl).join("[signed upload URL]");
  try {
    const u = new URL(uploadUrl);
    if (u.search.length > 1) out = out.split(u.search).join("?[redacted]");
    for (const [key, value] of u.searchParams) {
      if (/signature|credential/i.test(key) && value) out = out.split(value).join("[redacted]");
    }
  } catch {
    // not a parseable URL — the plain replacement above is all there is to do
  }
  return out.replace(/([?&][\w-]*Signature=)[^&\s"'<>]+/gi, "$1[redacted]");
}

/** Markdown for a comment body: images embed inline, anything else links. */
export function formatEmbed(r: Pick<UploadResult, "filename" | "assetUrl" | "contentType">): string {
  return `${isImage(r.contentType) ? "!" : ""}[${r.filename}](${r.assetUrl})`;
}

/**
 * A comment body with its uploads embedded: the body, a blank line, then one
 * embed per line. An empty body is just the embeds. Shared by `comment add
 * --attach` and `issue attach --comment` so both read the same way.
 */
export function appendEmbeds(
  body: string | undefined,
  uploads: Array<Pick<UploadResult, "filename" | "assetUrl" | "contentType">>,
): string {
  const embeds = uploads.map(formatEmbed).join("\n");
  if (!embeds) return body ?? "";
  return body?.trim() ? `${body}\n\n${embeds}` : embeds;
}

/** `70 B`, `12 KB`, `1.5 KB`, `3 MB` — for the human receipt. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const rounded = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${rounded} ${units[i]}`;
}
