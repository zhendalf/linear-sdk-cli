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

    const code = classify(name, type);
    return new CliError(message, code, gqlErrors.length ? gqlErrors : undefined);
  }

  return new CliError(String(err), "runtime");
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
