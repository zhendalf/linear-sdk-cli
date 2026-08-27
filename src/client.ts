/**
 * LinearClient factory + a thin retry wrapper for rate limits.
 */

import { LinearClient } from "@linear/sdk";
import type { ResolvedConfig } from "./config.js";
import { authError, normalizeError, CliError } from "./lib/errors.js";

export function createClient(config: ResolvedConfig): LinearClient {
  if (config.accessToken) {
    return new LinearClient({ accessToken: config.accessToken });
  }
  if (!config.apiKey) {
    // Surface the precise credential-selection error (ambiguous / unstored
    // workspace) only now, when a client is actually required.
    throw (
      config.apiKeyError ??
      authError(
        "No Linear credential found. Set LINEAR_ACCESS_TOKEN or LINEAR_API_KEY, pass --access-token or --api-key, or run `linear auth login`.",
      )
    );
  }
  return new LinearClient({ apiKey: config.apiKey });
}

/**
 * The longest single wait `withRetry` will honour. Linear's request quota
 * resets hourly, so a `Retry-After` can be in the thousands of seconds; a CLI
 * that silently sleeps that long looks hung (and an agent's tool call just
 * times out). Beyond this we fail fast with the reset time in the message so
 * the caller can schedule instead of wait.
 */
export const MAX_RETRY_WAIT_MS = 30_000;

export interface RetryOptions {
  /** Retries after the first attempt for a rate limit (default 3). */
  retries?: number;
  /** Retries for a connection that was never opened (default 1). */
  networkRetries?: number;
  /** Backoff base when the response carries no Retry-After (default 500 ms). */
  baseDelayMs?: number;
  /** Longest single wait honoured (default MAX_RETRY_WAIT_MS). */
  maxWaitMs?: number;
  /** Clock seam for tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Where the one-line "retrying in Ns" note goes. Defaults to the reporter
   * installed with `setRetryReporter` (stderr); `null` silences it.
   */
  report?: ((line: string) => void) | null;
}

type Reporter = (line: string) => void;

/** Plain stderr line — status, never data, so it cannot pollute `--json` stdout. */
const stderrReporter: Reporter = (line) => {
  process.stderr.write(line + "\n");
};

let retryReporter: Reporter | null = stderrReporter;

/**
 * Install the sink for retry status lines. The Context wires this to its
 * `Output.info` so `--quiet` is honoured; until then (and for library callers)
 * the default writes to stderr. Pass `null` to silence.
 */
export function setRetryReporter(fn: Reporter | null): void {
  retryReporter = fn;
}

/**
 * Transport failures where the request provably never reached Linear, so a
 * retry cannot duplicate a mutation. `ETIMEDOUT`/`ECONNRESET` are NOT here:
 * the request may have been sent, and `withRetry` wraps creates.
 */
const NEVER_SENT = new Set(["ConnectionRefused", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

/**
 * Execute a Linear call, retrying on rate-limit with exponential backoff and
 * normalizing any failure into a CliError. Used to wrap every service call.
 *
 * A 429 is safe to retry unconditionally (the request was rejected, not run).
 * A connection that was refused or a name that did not resolve is retried once
 * for the same reason. Anything else — including 5xx, which for a mutation may
 * or may not have executed — is thrown as-is.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const networkRetries = opts.networkRetries ?? 1;
  const base = opts.baseDelayMs ?? 500;
  const maxWait = opts.maxWaitMs ?? MAX_RETRY_WAIT_MS;
  const sleep = opts.sleep ?? delay;
  const report = opts.report === undefined ? retryReporter : opts.report;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const normalized = normalizeError(err);
      const kind = retryKind(normalized);
      const budget = kind === "rate_limited" ? retries : kind === "network" ? networkRetries : 0;
      if (!kind || attempt >= budget) throw normalized;
      attempt++;
      const hinted = kind === "rate_limited" ? retryAfterMs(err) : undefined;
      const wait = hinted ?? base * 2 ** (attempt - 1);
      if (wait > maxWait) throw waitTooLong(normalized, wait);
      report?.(
        `${kind === "rate_limited" ? "rate limited" : "connection failed"}; retrying in ${formatSeconds(wait)} (attempt ${attempt}/${budget})`,
      );
      await sleep(wait);
    }
  }
}

function retryKind(err: CliError): "rate_limited" | "network" | undefined {
  if (err.code === "rate_limited") return "rate_limited";
  if (err.code === "network") {
    const code = (err.detail as { code?: unknown } | undefined)?.code;
    if (typeof code === "string" && NEVER_SENT.has(code)) return "network";
  }
  return undefined;
}

/**
 * Fail fast instead of sleeping past the cap: keep the `rate_limited` code (so
 * the exit code stays 5 and a script can key on it) and say when the quota
 * resets, so the caller can schedule the retry.
 */
function waitTooLong(err: CliError, waitMs: number): CliError {
  const at = new Date(Date.now() + waitMs);
  return new CliError(
    `Rate limited by Linear; the quota resets in ${formatSeconds(waitMs)} (at ${at.toLocaleTimeString()}). Retry after that.`,
    "rate_limited",
    err.detail,
  );
}

/**
 * The server's Retry-After, in ms. Read from the SDK's parsed `retryAfter`
 * (seconds) or the raw header, which may be seconds or an HTTP-date.
 */
export function retryAfterMs(err: unknown): number | undefined {
  const e = err as { retryAfter?: unknown; raw?: { response?: { headers?: any } } } | undefined;
  const headers = e?.raw?.response?.headers;
  const value = headers?.get?.("retry-after") ?? headers?.["retry-after"] ?? e?.retryAfter;
  if (value === undefined || value === null || value === "") return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(String(value));
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function formatSeconds(ms: number): string {
  const secs = ms / 1000;
  if (secs >= 3600) return `${(secs / 3600).toFixed(1).replace(/\.0$/, "")}h`;
  if (secs >= 60) return `${Math.round(secs / 60)}m`;
  return `${secs < 10 ? secs.toFixed(1).replace(/\.0$/, "") : Math.round(secs)}s`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `conn.fetchNext()` behind `withRetry`, for pagination loops: page 1 of every
 * listing is already wrapped at its call site, but each later page is its own
 * request and can be rate limited on its own. `collect()` should advance with
 * `conn = await fetchNextWithRetry(conn)` rather than a bare `fetchNext()`.
 */
export function fetchNextWithRetry<C extends { fetchNext: () => Promise<C> }>(
  conn: C,
  opts?: RetryOptions,
): Promise<C> {
  return withRetry(() => conn.fetchNext(), opts);
}

export { CliError };
