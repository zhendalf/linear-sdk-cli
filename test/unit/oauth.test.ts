import { describe, expect, it } from "bun:test";
import { ClientCredentialsTokenProvider, OAuthTokenError } from "../../src/oauth.js";

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
