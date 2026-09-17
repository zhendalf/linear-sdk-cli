import type { ResolvedConfig } from "../config.js";
import { CliError, normalizeError } from "./errors.js";

export type CredentialType = "api-key" | "oauth-access-token" | "oauth-user" | null;
export type ScopeVisibility = "known" | "unknown" | "unavailable";

export interface AuthorizationCapabilities {
  credentialType: CredentialType;
  scopeVisibility: ScopeVisibility;
  scopes: string[] | null;
  adminScope: boolean | null;
  note: string;
}

export function credentialType(config: ResolvedConfig): CredentialType {
  if (config.oauthCredential) return "oauth-user";
  if (config.accessToken) return "oauth-access-token";
  if (config.apiKey) return "api-key";
  return null;
}

/**
 * Report only capabilities the CLI can establish without probing a mutation.
 * Stored OAuth grants carry their requested scopes. Linear exposes no safe
 * read-only scope introspection for personal API keys or injected access tokens.
 */
export function authorizationCapabilities(config: ResolvedConfig): AuthorizationCapabilities {
  const type = credentialType(config);
  if (config.oauthCredential) {
    const scopes = [...config.oauthCredential.scopes];
    return {
      credentialType: type,
      scopeVisibility: "known",
      scopes,
      adminScope: scopes.includes("admin"),
      note: "Stored OAuth grant scopes are known; workspace role is a separate authorization check.",
    };
  }
  if (type) {
    return {
      credentialType: type,
      scopeVisibility: "unknown",
      scopes: null,
      adminScope: null,
      note:
        type === "api-key"
          ? "Linear does not expose personal API-key scopes for read-only introspection; workspace role alone does not prove admin-scope access."
          : "Injected OAuth token scopes are not available to the CLI; workspace role alone does not prove admin-scope access.",
    };
  }
  return {
    credentialType: null,
    scopeVisibility: "unavailable",
    scopes: null,
    adminScope: null,
    note: "No active credential is available to inspect.",
  };
}

function requiredScope(error: CliError): string | undefined {
  const text = [error.message, JSON.stringify(error.detail ?? "")].join(" ");
  if (/admin[^.]{0,40}scope|scope[^.]{0,40}admin/i.test(text)) return "admin";
  return undefined;
}

/** Add safe, stable authorization context to scope-related forbidden failures. */
export function enrichAuthorizationError(error: unknown, config: ResolvedConfig): CliError {
  const normalized = normalizeError(error);
  if (normalized.code !== "forbidden") return normalized;
  const required = requiredScope(normalized);
  if (!required) return normalized;

  const capabilities = authorizationCapabilities(config);
  const remediation =
    capabilities.credentialType === "oauth-user"
      ? "Re-authenticate with `linear auth login --admin`; member admin status alone is insufficient."
      : "Use a credential authorized for the admin scope; member admin status alone is insufficient.";
  return new CliError(
    normalized.message,
    normalized.code,
    normalized.detail,
    normalized.suggestion ?? remediation,
    {
      requiredScope: required,
      credentialType: capabilities.credentialType,
      scopeVisibility: capabilities.scopeVisibility,
      grantedScopes: capabilities.scopes,
      remediation,
    },
  );
}
