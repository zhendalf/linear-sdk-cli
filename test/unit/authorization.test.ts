import { describe, expect, it } from "bun:test";
import {
  authorizationCapabilities,
  enrichAuthorizationError,
} from "../../src/lib/authorization.js";

const config = (overrides: Record<string, unknown> = {}): any => ({
  apiKeySource: "none",
  accessTokenSource: "none",
  ...overrides,
});

describe("authorization capabilities", () => {
  it("reports stored OAuth scopes as known and separate from member role", () => {
    expect(
      authorizationCapabilities(
        config({
          accessToken: "token",
          oauthCredential: { scopes: ["read", "write", "admin"] },
        }),
      ),
    ).toMatchObject({
      credentialType: "oauth-user",
      scopeVisibility: "known",
      scopes: ["read", "write", "admin"],
      adminScope: true,
    });
  });

  it("does not invent scope visibility for API keys or injected tokens", () => {
    expect(authorizationCapabilities(config({ apiKey: "key" }))).toMatchObject({
      credentialType: "api-key",
      scopeVisibility: "unknown",
      scopes: null,
      adminScope: null,
    });
    expect(authorizationCapabilities(config({ accessToken: "token" }))).toMatchObject({
      credentialType: "oauth-access-token",
      scopeVisibility: "unknown",
      scopes: null,
      adminScope: null,
    });
  });
});

describe("authorization error context", () => {
  it("adds stable remediation details to an admin-scope forbidden error", () => {
    class ForbiddenError extends Error {}
    const error = enrichAuthorizationError(
      new ForbiddenError("The token is missing the required 'admin' scope."),
      config({ apiKey: "key", apiKeySource: "env" }),
    );
    expect(error).toMatchObject({
      code: "forbidden",
      details: {
        requiredScope: "admin",
        credentialType: "api-key",
        scopeVisibility: "unknown",
        grantedScopes: null,
      },
    });
    expect(error.suggestion).toMatch(/credential authorized for the admin scope/i);
  });

  it("leaves unrelated forbidden errors alone", () => {
    class ForbiddenError extends Error {}
    const original = new ForbiddenError("You cannot edit that project.");
    const error = enrichAuthorizationError(original, config({ apiKey: "key" }));
    expect(error.code).toBe("forbidden");
    expect(error.details).toBeUndefined();
  });
});
