import { describe, it, expect, afterEach } from "bun:test";
import {
  withRetry,
  fetchNextWithRetry,
  retryAfterMs,
  setRetryReporter,
  MAX_RETRY_WAIT_MS,
} from "../../src/client.js";
import { CliError, ExitCode } from "../../src/lib/errors.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "../../src/client.js";
import { resolveConfig, writeOAuthCredential, readOAuthCredential } from "../../src/config.js";
import { memoryKeyring, setKeyringBackend } from "../../src/lib/keyring.js";
import type { OAuthUserCredential } from "../../src/oauth.js";

/**
 * Faithful to the SDK: `RatelimitedLinearError` carries `type`, `status` and
 * the raw response whose headers hold Retry-After (the SDK also copies it to
 * `retryAfter`, in seconds).
 */
class RatelimitedLinearError extends Error {
  type = "Ratelimited";
  status = 429;
  retryAfter?: number;
  raw: any;
  constructor(retryAfter?: string) {
    super("Ratelimited");
    const headers = new Headers(retryAfter === undefined ? {} : { "retry-after": retryAfter });
    this.raw = { response: { status: 429, headers } };
    const n = Number(retryAfter);
    if (retryAfter !== undefined && Number.isFinite(n)) this.retryAfter = n;
  }
}

/** What the SDK throws for a refused connection: UnknownLinearError, no status, raw.code. */
class UnknownLinearError extends Error {
  type = "Unknown";
  status = undefined;
  raw: any;
  constructor(code: string) {
    super("Unable to connect. Is the computer able to access the url?");
    this.raw = { code, path: "", errno: 0, name: "Error", message: this.message };
  }
}

class InternalLinearError extends Error {
  type = "InternalError";
  status = 500;
}

/** A fake clock: records requested waits, never actually sleeps. */
function fakeClock() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

function collectLines() {
  const lines: string[] = [];
  return { lines, report: (l: string) => void lines.push(l) };
}

afterEach(() => setRetryReporter(null));

describe("withRetry — rate limits", () => {
  it("retries a 429 with exponential backoff when there is no Retry-After", async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await withRetry(
      async () => {
        if (calls++ < 3) throw new RatelimitedLinearError();
        return "ok";
      },
      { sleep: clock.sleep, report: null },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(4);
    expect(clock.waits).toEqual([500, 1000, 2000]);
  });

  it("honours Retry-After (seconds) over the backoff schedule", async () => {
    const clock = fakeClock();
    let calls = 0;
    await withRetry(
      async () => {
        if (calls++ === 0) throw new RatelimitedLinearError("7");
        return 1;
      },
      { sleep: clock.sleep, report: null },
    );
    expect(clock.waits).toEqual([7000]);
  });

  it("gives up after `retries` and throws the normalized rate_limited error", async () => {
    const clock = fakeClock();
    let calls = 0;
    const p = withRetry(
      async () => {
        calls++;
        throw new RatelimitedLinearError();
      },
      { retries: 2, sleep: clock.sleep, report: null },
    );
    await expect(p).rejects.toBeInstanceOf(CliError);
    await p.catch((e: CliError) => {
      expect(e.code).toBe("rate_limited");
      expect(e.exitCode).toBe(ExitCode.RateLimited);
    });
    expect(calls).toBe(3);
    expect(clock.waits).toHaveLength(2);
  });

  it("says what is happening: one stderr-bound line per wait", async () => {
    const clock = fakeClock();
    const out = collectLines();
    let calls = 0;
    await withRetry(
      async () => {
        if (calls++ < 2) throw new RatelimitedLinearError("2");
        return 1;
      },
      { sleep: clock.sleep, report: out.report },
    );
    expect(out.lines).toEqual([
      "rate limited; retrying in 2s (attempt 1/3)",
      "rate limited; retrying in 2s (attempt 2/3)",
    ]);
  });

  it("uses the installed reporter by default and honours setRetryReporter(null)", async () => {
    const clock = fakeClock();
    const out = collectLines();
    setRetryReporter(out.report);
    let calls = 0;
    const flaky = async () => {
      if (calls++ === 0) throw new RatelimitedLinearError("1");
      return 1;
    };
    await withRetry(flaky, { sleep: clock.sleep });
    expect(out.lines).toHaveLength(1);

    setRetryReporter(null);
    calls = 0;
    await withRetry(flaky, { sleep: clock.sleep });
    expect(out.lines).toHaveLength(1);
  });

  it("caps the wait: a Retry-After beyond the cap fails fast with the reset time, still rate_limited", async () => {
    const clock = fakeClock();
    let calls = 0;
    const p = withRetry(
      async () => {
        calls++;
        throw new RatelimitedLinearError("3600");
      },
      { sleep: clock.sleep, report: null },
    );
    await expect(p).rejects.toBeInstanceOf(CliError);
    await p.catch((e: CliError) => {
      expect(e.code).toBe("rate_limited");
      expect(e.exitCode).toBe(ExitCode.RateLimited);
      expect(e.message).toMatch(/resets in 1h \(at \d/);
    });
    // Never slept, never re-called: it failed fast.
    expect(clock.waits).toEqual([]);
    expect(calls).toBe(1);
  });

  it("the cap is 30 seconds by default and can be raised per call", async () => {
    expect(MAX_RETRY_WAIT_MS).toBe(30_000);
    const clock = fakeClock();
    let calls = 0;
    await withRetry(
      async () => {
        if (calls++ === 0) throw new RatelimitedLinearError("45");
        return 1;
      },
      { sleep: clock.sleep, report: null, maxWaitMs: 60_000 },
    );
    expect(clock.waits).toEqual([45_000]);
  });
});

describe("withRetry — transport failures", () => {
  it("retries a refused connection once (the request never left), then throws `network`", async () => {
    const clock = fakeClock();
    const out = collectLines();
    let calls = 0;
    const p = withRetry(
      async () => {
        calls++;
        throw new UnknownLinearError("ConnectionRefused");
      },
      { sleep: clock.sleep, report: out.report },
    );
    await expect(p).rejects.toBeInstanceOf(CliError);
    await p.catch((e: CliError) => expect(e.code).toBe("network"));
    expect(calls).toBe(2);
    expect(clock.waits).toEqual([500]);
    expect(out.lines).toEqual(["connection failed; retrying in 0.5s (attempt 1/1)"]);
  });

  it("does NOT retry a 5xx: for a mutation the request may have executed", async () => {
    const clock = fakeClock();
    let calls = 0;
    const p = withRetry(
      async () => {
        calls++;
        throw new InternalLinearError("Internal");
      },
      { sleep: clock.sleep, report: null },
    );
    await expect(p).rejects.toBeInstanceOf(CliError);
    expect(calls).toBe(1);
    expect(clock.waits).toEqual([]);
  });

  it("does NOT retry a timeout or reset: the request may have been sent", async () => {
    const clock = fakeClock();
    let calls = 0;
    const p = withRetry(
      async () => {
        calls++;
        throw new UnknownLinearError("ETIMEDOUT");
      },
      { sleep: clock.sleep, report: null },
    );
    await p.catch((e: CliError) => expect(e.code).toBe("network"));
    expect(calls).toBe(1);
  });
});

describe("withRetry — everything else", () => {
  it("throws non-retryable errors immediately, normalized", async () => {
    class AuthenticationLinearError extends Error {}
    let calls = 0;
    const p = withRetry(
      async () => {
        calls++;
        throw new AuthenticationLinearError("nope");
      },
      { report: null },
    );
    await p.catch((e: CliError) => expect(e.code).toBe("auth"));
    expect(calls).toBe(1);
  });

  it("returns the value on first success", async () => {
    expect(await withRetry(async () => 42, { report: null })).toBe(42);
  });
});

describe("stored OAuth client", () => {
  it("refreshes once after an authentication failure and retries with the rotated token", async () => {
    const root = mkdtempSync(join(tmpdir(), "linoauth-client-"));
    const savedXdg = process.env.XDG_CONFIG_HOME;
    const savedHome = process.env.HOME;
    const savedFetch = globalThis.fetch;
    process.env.XDG_CONFIG_HOME = join(root, "xdg");
    process.env.HOME = root;
    const kr = memoryKeyring();
    setKeyringBackend(kr);
    try {
      const credential: OAuthUserCredential = {
        version: 1,
        kind: "oauth-user",
        actor: "user",
        accessToken: "access-old",
        refreshToken: "refresh-old",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["read", "write"],
        tokenType: "Bearer",
        clientId: "public-client",
        workspace: { id: "org-1", name: "Acme", urlKey: "acme" },
        user: { id: "user-1", name: "Ada", email: "ada@example.com" },
      };
      writeOAuthCredential(credential);
      const authHeaders: string[] = [];
      let graphqlCalls = 0;
      globalThis.fetch = (async (input, init) => {
        if (String(input).endsWith("/oauth/token")) {
          expect(String(init?.body)).toContain("refresh_token=refresh-old");
          return Response.json({
            access_token: "access-new",
            refresh_token: "refresh-new",
            expires_in: 3600,
            scope: "read write",
            token_type: "Bearer",
          });
        }
        graphqlCalls++;
        authHeaders.push(new Headers(init?.headers).get("Authorization") ?? "");
        if (graphqlCalls === 1) {
          return Response.json(
            {
              errors: [{ message: "Unauthenticated", extensions: { type: "AuthenticationError" } }],
            },
            { status: 401 },
          );
        }
        return Response.json({ data: { viewer: { id: "user-1", name: "Ada" } } });
      }) as typeof fetch;
      const config = resolveConfig({
        cwd: root,
        env: { ...process.env, LINEAR_WORKSPACE: "acme" },
      });
      const viewer = await createClient(config).viewer;
      expect(viewer.id).toBe("user-1");
      expect(authHeaders).toEqual(["Bearer access-old", "Bearer access-new"]);
      expect(readOAuthCredential("acme")?.refreshToken).toBe("refresh-new");
    } finally {
      globalThis.fetch = savedFetch;
      setKeyringBackend(undefined);
      if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = savedXdg;
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("retryAfterMs", () => {
  it("reads seconds from the header", () => {
    expect(retryAfterMs(new RatelimitedLinearError("12"))).toBe(12_000);
  });

  it("reads an HTTP-date header", () => {
    const at = new Date(Date.now() + 90_000).toUTCString();
    const ms = retryAfterMs(new RatelimitedLinearError(at))!;
    expect(ms).toBeGreaterThan(85_000);
    expect(ms).toBeLessThanOrEqual(90_000);
  });

  it("falls back to the SDK's parsed retryAfter when only that is present", () => {
    expect(retryAfterMs({ retryAfter: 3 })).toBe(3000);
  });

  it("is undefined when nothing is hinted", () => {
    expect(retryAfterMs(new RatelimitedLinearError())).toBeUndefined();
    expect(retryAfterMs(new Error("x"))).toBeUndefined();
  });
});

describe("fetchNextWithRetry", () => {
  it("retries a rate-limited page fetch (the page-2 case) instead of failing the listing", async () => {
    const clock = fakeClock();
    let fetches = 0;
    const conn: any = {
      nodes: [1, 2],
      pageInfo: { hasNextPage: true },
      fetchNext: async () => {
        fetches++;
        if (fetches === 1) throw new RatelimitedLinearError("1");
        conn.nodes.push(3);
        conn.pageInfo.hasNextPage = false;
        return conn;
      },
    };
    const next = await fetchNextWithRetry(conn, { sleep: clock.sleep, report: null });
    expect(next).toBe(conn);
    expect(next.nodes).toEqual([1, 2, 3]);
    expect(fetches).toBe(2);
    expect(clock.waits).toEqual([1000]);
  });
});
