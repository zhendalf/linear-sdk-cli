import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { describe, expect, it } from "bun:test";
import {
  ClientCredentialsTokenProvider,
  OAuthTokenError,
  OAuthUserTokenProvider,
  buildAuthorizationUrl,
  createPkceRequest,
  exchangeAuthorizationCode,
  startLoopbackCallback,
  type OAuthUserCredential,
} from "../../src/oauth.js";

function tokenResponse(accessToken: string, expiresIn = 3600): Response {
  return Response.json({
    access_token: accessToken,
    expires_in: expiresIn,
    scope: "read write",
    token_type: "Bearer",
  });
}

describe("ClientCredentialsTokenProvider", () => {
  it("exchanges client credentials without putting secrets in the request URL or body", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const provider = new ClientCredentialsTokenProvider({
      clientId: "client-id",
      clientSecret: "client-secret",
      scopes: ["read", "write"],
      fetch: async (input, init) => {
        requests.push({ input: String(input), init });
        return tokenResponse("access-one");
      },
      now: () => 1_000,
    });

    const token = await provider.getAccessToken();

    expect(token).toEqual({
      accessToken: "access-one",
      expiresAt: 3_601_000,
      expiresIn: 3600,
      scope: "read write",
      tokenType: "Bearer",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe("https://api.linear.app/oauth/token");
    expect(requests[0]?.init?.headers).toEqual({
      Authorization: `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(String(requests[0]?.init?.body)).toBe(
      "grant_type=client_credentials&scope=read%2Cwrite",
    );
    expect(String(requests[0]?.init?.body)).not.toContain("client-secret");
  });

  it("caches a token, renews inside the expiry skew, and supports forced renewal", async () => {
    let now = 0;
    let calls = 0;
    const provider = new ClientCredentialsTokenProvider({
      clientId: "id",
      clientSecret: "secret",
      scopes: ["read"],
      refreshSkewMs: 100,
      now: () => now,
      fetch: async () => tokenResponse(`access-${++calls}`, 1),
    });

    expect((await provider.getAccessToken()).accessToken).toBe("access-1");
    expect((await provider.getAccessToken()).accessToken).toBe("access-1");
    now = 901;
    expect((await provider.getAccessToken()).accessToken).toBe("access-2");
    expect((await provider.getAccessToken({ forceRefresh: true })).accessToken).toBe("access-3");
    expect(calls).toBe(3);
  });

  it("coalesces concurrent exchanges and can invalidate the cached token", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const provider = new ClientCredentialsTokenProvider({
      clientId: "id",
      clientSecret: "secret",
      scopes: ["read"],
      fetch: async () => {
        calls++;
        await gate;
        return tokenResponse(`access-${calls}`);
      },
    });

    const first = provider.getAccessToken();
    const second = provider.getAccessToken();
    release();
    expect((await first).accessToken).toBe("access-1");
    expect((await second).accessToken).toBe("access-1");
    expect(calls).toBe(1);

    provider.invalidate();
    expect((await provider.getAccessToken()).accessToken).toBe("access-2");
  });

  it("returns non-secret errors for HTTP, network, and malformed response failures", async () => {
    const values = [
      async () => new Response("client-secret access-token", { status: 401 }),
      async () => {
        throw new Error("client-secret");
      },
      async () => Response.json({ access_token: "access-token" }),
    ];

    for (const fetch of values) {
      const provider = new ClientCredentialsTokenProvider({
        clientId: "id",
        clientSecret: "client-secret",
        scopes: ["read"],
        fetch,
      });
      const error = await provider.getAccessToken().then(
        () => undefined,
        (value: unknown) => value,
      );
      expect(error).toBeInstanceOf(OAuthTokenError);
      if (!(error instanceof OAuthTokenError)) throw new Error("Expected OAuthTokenError");
      expect(error.message).not.toContain("client-secret");
      expect(error.message).not.toContain("access-token");
    }
  });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function userCredential(overrides: Partial<OAuthUserCredential> = {}): OAuthUserCredential {
  return {
    version: 1,
    kind: "oauth-user",
    actor: "user",
    accessToken: "access-old",
    refreshToken: "refresh-old",
    expiresAt: 1_000,
    scopes: ["read", "write"],
    tokenType: "Bearer",
    clientId: "client-id",
    workspace: { id: "org-1", name: "Acme", urlKey: "acme" },
    user: { id: "user-1", name: "Ada", email: "ada@example.com" },
    ...overrides,
  };
}

describe("browser OAuth PKCE", () => {
  it("generates independent random state and a correct S256 challenge", () => {
    const first = createPkceRequest();
    const second = createPkceRequest();
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.state).not.toBe(first.verifier);
    expect(first.state).not.toBe(second.state);
    expect(first.verifier.length).toBeGreaterThanOrEqual(43);
    expect(first.challenge).toBe(
      createHash("sha256").update(first.verifier).digest().toString("base64url"),
    );
  });

  it("builds an actor=user authorization request with S256 and no secret", () => {
    const url = new URL(
      buildAuthorizationUrl({
        clientId: "public-client",
        redirectUri: "http://127.0.0.1:43821/oauth/callback",
        scopes: ["read", "write"],
        challenge: "challenge",
        state: "state",
      }),
    );
    expect(url.searchParams.get("actor")).toBe("user");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("read,write");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });

  it("validates state and rejects malformed callbacks without exposing callback data", async () => {
    for (const suffix of ["?code=secret-code&state=wrong", "?state=expected"]) {
      const port = await freePort();
      const callback = await startLoopbackCallback({
        redirectUri: `http://127.0.0.1:${port}/oauth/callback`,
        state: "expected",
        timeoutMs: 2_000,
      });
      const outcome = callback.wait.catch((value) => value as OAuthTokenError);
      await fetch(callback.redirectUri + suffix);
      const error = await outcome;
      expect(error).toBeInstanceOf(OAuthTokenError);
      if (!(error instanceof OAuthTokenError)) throw new Error("Expected OAuthTokenError");
      expect(error.message).not.toContain("secret-code");
      await callback.close();
    }
  });

  it("times out with a stable auth error", async () => {
    const port = await freePort();
    const callback = await startLoopbackCallback({
      redirectUri: `http://127.0.0.1:${port}/oauth/callback`,
      state: "expected",
      timeoutMs: 5,
    });
    const error = await callback.wait.catch((value) => value as OAuthTokenError);
    expect(error).toMatchObject({
      code: "auth",
      message: "Timed out waiting for the Linear OAuth callback.",
    });
  });

  it("exchanges a code with the verifier and without a client secret", async () => {
    let body = "";
    const token = await exchangeAuthorizationCode({
      code: "authorization-code",
      verifier: "verifier",
      clientId: "public-client",
      redirectUri: "http://127.0.0.1:43821/oauth/callback",
      now: () => 1_000,
      fetch: async (_input, init) => {
        body = String(init?.body);
        return Response.json({
          access_token: "access-new",
          refresh_token: "refresh-new",
          expires_in: 3600,
          scope: "read write",
          token_type: "Bearer",
        });
      },
    });
    expect(body).toContain("code_verifier=verifier");
    expect(body).toContain("client_id=public-client");
    expect(body).not.toContain("client_secret");
    expect(token).toEqual({
      accessToken: "access-new",
      refreshToken: "refresh-new",
      expiresAt: 3_601_000,
      scopes: ["read", "write"],
      tokenType: "Bearer",
    });
  });
});

describe("OAuthUserTokenProvider", () => {
  it("refreshes before expiry and persists rotating tokens with compare-and-swap input", async () => {
    const persisted: Array<{ previous: string; next: OAuthUserCredential }> = [];
    const provider = new OAuthUserTokenProvider({
      credential: userCredential(),
      now: () => 1_000,
      persist: (previous, next) => {
        persisted.push({ previous, next });
        return next;
      },
      fetch: async () =>
        Response.json({
          access_token: "access-new",
          refresh_token: "refresh-new",
          expires_in: 3600,
          scope: "read write",
          token_type: "Bearer",
        }),
    });
    expect(await provider.getAccessToken()).toBe("access-new");
    expect(persisted[0]?.previous).toBe("refresh-old");
    expect(persisted[0]?.next.refreshToken).toBe("refresh-new");
  });

  it("retains a secret-safe recovery path when rotation persistence fails", async () => {
    const provider = new OAuthUserTokenProvider({
      credential: userCredential(),
      now: () => 1_000,
      persist: () => {
        throw new Error("refresh-new access-new");
      },
      fetch: async () =>
        Response.json({
          access_token: "access-new",
          refresh_token: "refresh-new",
          expires_in: 3600,
          scope: "read write",
          token_type: "Bearer",
        }),
    });
    const error = await provider.getAccessToken().catch((value) => value as OAuthTokenError);
    if (!(error instanceof OAuthTokenError)) throw new Error("Expected OAuthTokenError");
    expect(error.message).toContain("previous refresh token was retained");
    expect(error.message).not.toContain("refresh-new");
    expect(error.message).not.toContain("access-new");
  });
});
