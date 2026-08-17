/**
 * Error handling: a single `CliError` type the whole app throws, plus a
 * normalizer that maps Linear SDK errors into stable codes + exit codes.
 *
 * Exit codes (documented in PLAN.md):
 *   0 ok · 1 runtime/API · 2 usage · 3 not-found/ambiguous · 4 auth · 5 rate-limited
 */

export const ExitCode = {
  Ok: 0,
  Runtime: 1,
  Usage: 2,
  NotFound: 3,
  Auth: 4,
  RateLimited: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** Stable machine-readable error codes surfaced in the JSON error envelope. */
export type ErrorCode =
  | "usage"
  | "auth"
  | "not_found"
  | "ambiguous"
  | "forbidden"
  | "validation"
  | "rate_limited"
  | "network"
  | "feature_not_accessible"
  | "api"
  | "runtime";

const EXIT_BY_CODE: Record<ErrorCode, ExitCodeValue> = {
  usage: ExitCode.Usage,
  auth: ExitCode.Auth,
  not_found: ExitCode.NotFound,
  ambiguous: ExitCode.NotFound,
  forbidden: ExitCode.Auth,
  validation: ExitCode.Usage,
  rate_limited: ExitCode.RateLimited,
  network: ExitCode.Runtime,
  feature_not_accessible: ExitCode.Runtime,
  api: ExitCode.Runtime,
  runtime: ExitCode.Runtime,
};

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: ExitCodeValue;
  /** Extra detail surfaced only with --debug (e.g. raw GraphQL errors). */
  readonly detail?: unknown;

  constructor(message: string, code: ErrorCode = "runtime", detail?: unknown) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = EXIT_BY_CODE[code];
    this.detail = detail;
  }
}

/** Convenience constructors for the common cases. */
export const usageError = (m: string) => new CliError(m, "usage");
export const notFound = (m: string) => new CliError(m, "not_found");
export const ambiguous = (m: string) => new CliError(m, "ambiguous");
export const authError = (m: string) => new CliError(m, "auth");

/**
 * Map an unknown thrown value (typically a Linear SDK error) into a CliError
 * with a stable code. We classify by the SDK error class name + GraphQL error
 * `extensions.type` so behavior is predictable across SDK versions.
 */
export function normalizeError(err: unknown): CliError {
  if (err instanceof CliError) return err;

  if (err instanceof Error) {
    const name = err.constructor?.name ?? err.name ?? "";
    const anyErr = err as Record<string, any>;
    const gqlErrors: any[] = anyErr.errors ?? anyErr.raw?.response?.errors ?? [];
    const type: string | undefined =
      anyErr.type ?? gqlErrors[0]?.extensions?.type ?? gqlErrors[0]?.extensions?.code;
    const message = pickMessage(err, gqlErrors);

    // A request that never got an HTTP response is a transport failure, however
    // the SDK labelled it (it says `UnknownLinearError`, type Unknown, for a
    // refused connection). Classify by the socket error underneath.
    const transport = transportFailure(anyErr);
    let code = transport ? "network" : classify(name, type);
    // Linear surfaces "could not find referenced X" as a validation error, but
    // semantically it is a not-found — reclassify so `view <bad-id>` exits 3.
    if (
      (code === "validation" || code === "api") &&
      /could ?n[o']t find|not found|does not exist|no such|referenced \w+\.?$/i.test(message)
    ) {
      code = "not_found";
    }
    // `--debug` detail: the GraphQL errors when there are any; otherwise what
    // the transport said, since that is all there is to show.
    const detail = gqlErrors.length ? gqlErrors : (transport ?? rawDetail(anyErr));
    return new CliError(message, code, detail);
  }

  return new CliError(String(err), "runtime");
}

/**
 * Socket / DNS / fetch failure codes as bun and node's fetch spell them (bun:
 * `ConnectionRefused`, `FailedToOpenSocket`; node/undici: errno names and
 * `UND_ERR_*`), plus a bare `TypeError: fetch failed`.
 */
const TRANSPORT_CODES =
  /^(ConnectionRefused|ConnectionClosed|FailedToOpenSocket|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_\w+)$/;

interface TransportDetail {
  name?: string;
  code?: string;
  status?: undefined;
}

/**
 * Detect a request that failed before any HTTP response existed. A real
 * status — even a 5xx — is an answer from the API and is left to `classify`.
 */
function transportFailure(err: Record<string, any>): TransportDetail | undefined {
  if (err.status !== undefined && err.status !== null) return undefined;
  const raw = err.raw ?? err;
  if (raw?.response?.status !== undefined) return undefined;
  const candidates = [raw, raw?.cause, err.cause].filter(Boolean);
  for (const c of candidates) {
    const code = typeof c.code === "string" ? c.code : undefined;
    if (code && TRANSPORT_CODES.test(code)) return { name: c.name, code };
    if (c instanceof TypeError && /fetch failed|unable to connect|network/i.test(c.message ?? "")) {
      return { name: c.name, code };
    }
  }
  return undefined;
}

/** `{name, code, status}` from the SDK's raw error, when any of them is set. */
function rawDetail(err: Record<string, any>): Record<string, unknown> | undefined {
  const raw = err.raw;
  const detail = {
    name: raw?.name,
    code: raw?.code,
    status: err.status ?? raw?.response?.status,
  };
  return Object.values(detail).some((v) => v !== undefined) ? detail : undefined;
}

function classify(name: string, type: string | undefined): ErrorCode {
  const n = `${name} ${type ?? ""}`.toLowerCase();
  if (n.includes("authentication")) return "auth";
  if (n.includes("ratelimit")) return "rate_limited";
  if (n.includes("forbidden")) return "forbidden";
  if (n.includes("featurenotaccessible") || n.includes("usagelimit"))
    return "feature_not_accessible";
  if (n.includes("invalidinput") || n.includes("validation")) return "validation";
  if (n.includes("network")) return "network";
  if (name.includes("LinearError") || name.includes("GraphQL")) return "api";
  return "runtime";
}

function pickMessage(err: Error, gqlErrors: any[]): string {
  const fromGql = gqlErrors
    .map((e) => e?.message)
    .filter(Boolean)
    .join("; ");
  return fromGql || err.message || "Unknown error";
}
