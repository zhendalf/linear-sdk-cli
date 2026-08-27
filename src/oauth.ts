const DEFAULT_TOKEN_ENDPOINT = "https://api.linear.app/oauth/token";
const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;

type OAuthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ClientCredentialsTokenProviderOptions {
  clientId: string;
  clientSecret: string;
  scopes: readonly string[];
  /** Renew this long before the server-reported expiry (default five minutes). */
  refreshSkewMs?: number;
  /** Test seam; production callers should use Linear's default endpoint. */
  tokenEndpoint?: string;
  /** Test seam for HTTP. */
  fetch?: OAuthFetch;
  /** Test seam for expiry calculations. */
  now?: () => number;
}

export interface OAuthAccessToken {
  accessToken: string;
  expiresAt: number;
  expiresIn: number;
  scope: string;
  tokenType: string;
}

export interface GetAccessTokenOptions {
  /** Mint a replacement even when the cached token has not reached its renewal window. */
  forceRefresh?: boolean;
}

/** A non-secret OAuth failure suitable for logs and CLI error normalization. */
export class OAuthTokenError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "OAuthTokenError";
    this.status = status;
  }
}

/**
 * Keeps one client-credentials access token in memory for a long-lived app host.
 * The provider never persists or prints the client secret or returned token.
 */
export class ClientCredentialsTokenProvider {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #scopes: readonly string[];
  readonly #refreshSkewMs: number;
  readonly #tokenEndpoint: string;
  readonly #fetch: OAuthFetch;
  readonly #now: () => number;
  #cached?: OAuthAccessToken;
  #pending?: Promise<OAuthAccessToken>;

  constructor(options: ClientCredentialsTokenProviderOptions) {
    if (!options.clientId.trim()) throw new OAuthTokenError("OAuth client ID is required.");
    if (!options.clientSecret) throw new OAuthTokenError("OAuth client secret is required.");
    if (options.scopes.length === 0 || options.scopes.some((scope) => !scope.trim())) {
      throw new OAuthTokenError("At least one non-empty OAuth scope is required.");
    }
    const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
    if (!Number.isFinite(refreshSkewMs) || refreshSkewMs < 0) {
      throw new OAuthTokenError("OAuth refresh skew must be a non-negative finite number.");
    }

    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#scopes = [...new Set(options.scopes)];
    this.#refreshSkewMs = refreshSkewMs;
    this.#tokenEndpoint = options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
  }

  async getAccessToken(options: GetAccessTokenOptions = {}): Promise<OAuthAccessToken> {
    if (!options.forceRefresh && this.#cached && !this.#shouldRefresh(this.#cached)) {
      return this.#cached;
    }
    if (this.#pending) return this.#pending;

    const pending = this.#exchange();
    this.#pending = pending;
    try {
      const token = await pending;
      this.#cached = token;
      return token;
    } finally {
      if (this.#pending === pending) this.#pending = undefined;
    }
  }

  /** Drop the cached access token, typically after Linear rejects it with HTTP 401. */
  invalidate(): void {
    this.#cached = undefined;
  }

  #shouldRefresh(token: OAuthAccessToken): boolean {
    const lifetimeMs = token.expiresIn * 1000;
    const skewMs = Math.min(this.#refreshSkewMs, lifetimeMs / 2);
    return this.#now() >= token.expiresAt - skewMs;
  }

  async #exchange(): Promise<OAuthAccessToken> {
    const authorization = Buffer.from(`${this.#clientId}:${this.#clientSecret}`).toString("base64");
    let response: Response;
    try {
      response = await this.#fetch(this.#tokenEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${authorization}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: this.#scopes.join(","),
        }),
      });
    } catch {
      throw new OAuthTokenError("Unable to reach Linear's OAuth token endpoint.");
    }

    if (!response.ok) {
      throw new OAuthTokenError(
        `Linear OAuth token exchange failed (HTTP ${response.status}).`,
        response.status,
      );
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new OAuthTokenError(
        "Linear OAuth token exchange returned malformed JSON.",
        response.status,
      );
    }
    const token = parseTokenResponse(value);
    return {
      ...token,
      expiresAt: this.#now() + token.expiresIn * 1000,
    };
  }
}

function parseTokenResponse(value: unknown): Omit<OAuthAccessToken, "expiresAt"> {
  if (!value || typeof value !== "object") {
    throw new OAuthTokenError("Linear OAuth token exchange returned an invalid response.");
  }
  const response = value as Record<string, unknown>;
  const accessToken = response.access_token;
  const expiresIn = response.expires_in;
  const scope = response.scope;
  const tokenType = response.token_type;
  if (
    typeof accessToken !== "string" ||
    !accessToken ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    typeof scope !== "string" ||
    typeof tokenType !== "string" ||
    tokenType.toLowerCase() !== "bearer"
  ) {
    throw new OAuthTokenError("Linear OAuth token exchange returned an invalid response.");
  }
  return { accessToken, expiresIn, scope, tokenType };
}
