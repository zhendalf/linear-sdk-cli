/**
 * LinearClient factory + a thin retry wrapper for rate limits.
 */

import { LinearClient } from "@linear/sdk";
import type { ResolvedConfig } from "./config.js";
import { authError, normalizeError, CliError } from "./lib/errors.js";

export function createClient(config: ResolvedConfig): LinearClient {
  if (!config.apiKey) {
    throw authError(
      "No API key found. Set LINEAR_API_KEY, pass --api-key, or run `linear auth login`.",
    );
  }
  return new LinearClient({ apiKey: config.apiKey });
}

/**
 * Execute a Linear call, retrying on rate-limit with exponential backoff and
 * normalizing any failure into a CliError. Used to wrap every service call.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 500;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const normalized = normalizeError(err);
      if (normalized.code === "rate_limited" && attempt < retries) {
        const wait = retryAfterMs(err) ?? base * 2 ** attempt;
        await delay(wait);
        attempt++;
        continue;
      }
      throw normalized;
    }
  }
}

function retryAfterMs(err: unknown): number | undefined {
  const headers = (err as any)?.raw?.response?.headers;
  const value = headers?.get?.("retry-after") ?? headers?.["retry-after"];
  if (!value) return undefined;
  const secs = Number(value);
  return Number.isFinite(secs) ? secs * 1000 : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { CliError };
