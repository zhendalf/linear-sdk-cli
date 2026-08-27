import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { CliError, type ErrorCode } from "./lib/errors.js";

export const LINEAR_AUTHORIZE_ENDPOINT = "https://linear.app/oauth/authorize";
export const LINEAR_TOKEN_ENDPOINT = "https://api.linear.app/oauth/token";
export const LINEAR_REVOKE_ENDPOINT = "https://api.linear.app/oauth/revoke";
export const DEFAULT_OAUTH_CALLBACK_TIMEOUT_MS = 2 * 60 * 1000;
export const DEFAULT_OAUTH_REFRESH_SKEW_MS = 5 * 60 * 1000;
export const DEFAULT_OAUTH_SCOPES = ["read", "write"] as const;

type OAuthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ClientCredentialsTokenProviderOptions {
  clientId: string;
  clientSecret: string;
  scopes: readonly string[];
  refreshSkewMs?: number;
  tokenEndpoint?: string;
  fetch?: OAuthFetch;
  now?: () => number;
}

export interface OAuthAccessToken {
  accessToken: string;
  expiresAt: number;
  expiresIn: number;
  scope: string;
  tokenType: string;
}

export interface OAuthWorkspaceIdentity {
  id: string;
  name: string;
  urlKey: string;
}

export interface OAuthUserIdentity {
  id: string;
  name: string;
  email: string;
}

/** Entire human OAuth session. It is serialized only into the OS keyring. */
export interface OAuthUserCredential {
  version: 1;
  kind: "oauth-user";
  actor: "user";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  tokenType: "Bearer";
  clientId: string;
  workspace: OAuthWorkspaceIdentity;
  user: OAuthUserIdentity;
}

export interface GetAccessTokenOptions {
  forceRefresh?: boolean;
}

/** A stable, deliberately non-secret OAuth failure. */
export class OAuthTokenError extends CliError {
  readonly status?: number;

  constructor(message: string, status?: number, code: ErrorCode = "auth") {
    super(message, code);
    this.name = "OAuthTokenError";
    this.status = status;
  }
}

function base64url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export interface PkceRequest {
  verifier: string;
  challenge: string;
  state: string;
}

/** RFC 7636 verifier/challenge plus an independent CSRF nonce. */
export function createPkceRequest(): PkceRequest {
  const verifier = base64url(randomBytes(32));
  return {
    verifier,
    challenge: base64url(createHash("sha256").update(verifier).digest()),
    state: base64url(randomBytes(32)),
  };
}

export function buildAuthorizationUrl(options: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  challenge: string;
  state: string;
}): string {
  if (!options.clientId.trim()) {
    throw new OAuthTokenError(
      "Browser OAuth is not configured. Set LINEAR_OAUTH_CLIENT_ID to a Linear OAuth application client ID.",
      undefined,
      "usage",
    );
  }
  const url = new URL(LINEAR_AUTHORIZE_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: validateLoopbackRedirectUri(options.redirectUri).toString(),
    response_type: "code",
    scope: [...new Set(options.scopes)].join(","),
    actor: "user",
    state: options.state,
    code_challenge: options.challenge,
    code_challenge_method: "S256",
    prompt: "consent",
  }).toString();
  return url.toString();
}

export function validateLoopbackRedirectUri(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthTokenError("OAuth redirect URI is invalid.", undefined, "usage");
  }
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]" && url.hostname !== "::1") ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new OAuthTokenError(
      "OAuth redirect URI must be an HTTP loopback URL with an explicit port and no query or fragment.",
      undefined,
      "usage",
    );
  }
  return url;
}

export interface LoopbackCallback {
  redirectUri: string;
  wait: Promise<string>;
  close(): Promise<void>;
}

function safeStateEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function callbackPage(ok: boolean): string {
  const title = ok ? "Linear authentication complete" : "Linear authentication failed";
  const body = ok
    ? "You can close this window and return to the terminal."
    : "Return to the terminal for a safe error message, then retry.";
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1><p>${body}</p>`;
}

/** Bind the registered loopback URI before opening the browser and await one valid callback. */
export async function startLoopbackCallback(options: {
  redirectUri: string;
  state: string;
  timeoutMs?: number;
}): Promise<LoopbackCallback> {
  const url = validateLoopbackRedirectUri(options.redirectUri);
  const timeoutMs = options.timeoutMs ?? DEFAULT_OAUTH_CALLBACK_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new OAuthTokenError(
      "OAuth callback timeout must be greater than zero.",
      undefined,
      "usage",
    );
  }

  let settled = false;
  let resolveWait!: (code: string) => void;
  let rejectWait!: (error: Error) => void;
  const wait = new Promise<string>((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
  });
  const settle = (error?: Error, code?: string): void => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (error) rejectWait(error);
    else resolveWait(code!);
    server.close();
  };

  const server: Server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", url.origin);
    if (request.method !== "GET" || requestUrl.pathname !== url.pathname) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
    const receivedState = requestUrl.searchParams.get("state") ?? "";
    const denied = requestUrl.searchParams.get("error");
    const code = requestUrl.searchParams.get("code");
    let error: Error | undefined;
    if (!safeStateEqual(options.state, receivedState)) {
      error = new OAuthTokenError(
        "Linear OAuth callback state did not match; authentication was cancelled.",
      );
    } else if (denied) {
      error = new OAuthTokenError("Linear OAuth consent was denied or cancelled.");
    } else if (!code || requestUrl.searchParams.has("access_token")) {
      error = new OAuthTokenError("Linear OAuth callback was malformed.");
    }
    response.writeHead(error ? 400 : 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(callbackPage(!error));
    settle(error, code ?? undefined);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", () =>
      reject(
        new OAuthTokenError(
          "Could not start the Linear OAuth loopback callback listener.",
          undefined,
          "runtime",
        ),
      ),
    );
    server.listen(Number(url.port), url.hostname.replace(/^\[|\]$/g, ""), resolve);
  });
  const timer = setTimeout(
    () => settle(new OAuthTokenError("Timed out waiting for the Linear OAuth callback.")),
    timeoutMs,
  );
  timer.unref?.();

  return {
    redirectUri: url.toString(),
    wait,
    close: () =>
      new Promise<void>((resolve) => {
        if (timer) clearTimeout(timer);
        if (!server.listening) return resolve();
        server.close(() => resolve());
      }),
  };
}

interface ParsedTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope: string;
  scopes: string[];
  tokenType: "Bearer";
}

function parseTokenResponse(value: unknown, requireRefreshToken = false): ParsedTokenResponse {
  if (!value || typeof value !== "object") {
    throw new OAuthTokenError("Linear OAuth token exchange returned an invalid response.");
  }
  const response = value as Record<string, unknown>;
  const accessToken = response.access_token;
  const refreshToken = response.refresh_token;
  const expiresIn = response.expires_in;
  const rawScope = response.scope;
  const tokenType = response.token_type;
  const scopes = Array.isArray(rawScope)
    ? rawScope.filter((scope): scope is string => typeof scope === "string" && !!scope)
    : typeof rawScope === "string"
      ? rawScope.split(/[ ,]+/).filter(Boolean)
      : [];
  if (
    typeof accessToken !== "string" ||
    !accessToken ||
    (requireRefreshToken && (typeof refreshToken !== "string" || !refreshToken)) ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    scopes.length === 0 ||
    typeof tokenType !== "string" ||
    tokenType.toLowerCase() !== "bearer"
  ) {
    throw new OAuthTokenError("Linear OAuth token exchange returned an invalid response.");
  }
  return {
    accessToken,
    refreshToken: typeof refreshToken === "string" ? refreshToken : undefined,
    expiresIn,
    scope: scopes.join(" "),
    scopes,
    tokenType: "Bearer",
  };
}

async function postTokenForm(
  body: URLSearchParams,
  options: { endpoint?: string; fetch?: OAuthFetch } = {},
): Promise<ParsedTokenResponse> {
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(
      options.endpoint ?? LINEAR_TOKEN_ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
  } catch {
    throw new OAuthTokenError(
      "Unable to reach Linear's OAuth token endpoint.",
      undefined,
      "network",
    );
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
  return parseTokenResponse(value, true);
}

export async function exchangeAuthorizationCode(options: {
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  fetch?: OAuthFetch;
  tokenEndpoint?: string;
  now?: () => number;
}): Promise<
  Pick<OAuthUserCredential, "accessToken" | "refreshToken" | "expiresAt" | "scopes" | "tokenType">
> {
  const token = await postTokenForm(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: validateLoopbackRedirectUri(options.redirectUri).toString(),
      client_id: options.clientId,
      code_verifier: options.verifier,
    }),
    { endpoint: options.tokenEndpoint, fetch: options.fetch },
  );
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken!,
    expiresAt: (options.now ?? Date.now)() + token.expiresIn * 1000,
    scopes: token.scopes,
    tokenType: "Bearer",
  };
}

export interface OAuthUserTokenProviderOptions {
  credential: OAuthUserCredential;
  persist: (previousRefreshToken: string, next: OAuthUserCredential) => OAuthUserCredential;
  refreshSkewMs?: number;
  tokenEndpoint?: string;
  fetch?: OAuthFetch;
  now?: () => number;
}

/** Refreshes a PKCE user session and atomically hands rotation to the keyring store. */
export class OAuthUserTokenProvider {
  #credential: OAuthUserCredential;
  readonly #persist: OAuthUserTokenProviderOptions["persist"];
  readonly #refreshSkewMs: number;
  readonly #tokenEndpoint?: string;
  readonly #fetch?: OAuthFetch;
  readonly #now: () => number;
  #pending?: Promise<OAuthUserCredential>;

  constructor(options: OAuthUserTokenProviderOptions) {
    this.#credential = options.credential;
    this.#persist = options.persist;
    this.#refreshSkewMs = options.refreshSkewMs ?? DEFAULT_OAUTH_REFRESH_SKEW_MS;
    this.#tokenEndpoint = options.tokenEndpoint;
    this.#fetch = options.fetch;
    this.#now = options.now ?? Date.now;
  }

  get credential(): OAuthUserCredential {
    return this.#credential;
  }

  async getAccessToken(options: GetAccessTokenOptions = {}): Promise<string> {
    if (!options.forceRefresh && this.#now() < this.#credential.expiresAt - this.#refreshSkewMs) {
      return this.#credential.accessToken;
    }
    if (!this.#pending) this.#pending = this.#refresh();
    try {
      this.#credential = await this.#pending;
      return this.#credential.accessToken;
    } finally {
      this.#pending = undefined;
    }
  }

  async #refresh(): Promise<OAuthUserCredential> {
    const previous = this.#credential;
    const token = await postTokenForm(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: previous.refreshToken,
        client_id: previous.clientId,
      }),
      { endpoint: this.#tokenEndpoint, fetch: this.#fetch },
    );
    const next: OAuthUserCredential = {
      ...previous,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken!,
      expiresAt: this.#now() + token.expiresIn * 1000,
      scopes: token.scopes,
      tokenType: "Bearer",
    };
    try {
      return this.#persist(previous.refreshToken, next);
    } catch {
      throw new OAuthTokenError(
        "Linear OAuth refreshed, but the rotated credential could not be saved. The previous refresh token was retained for recovery.",
        undefined,
        "runtime",
      );
    }
  }
}

export async function revokeOAuthToken(options: {
  token: string;
  tokenTypeHint: "access_token" | "refresh_token";
  endpoint?: string;
  fetch?: OAuthFetch;
}): Promise<"revoked" | "already-revoked"> {
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(
      options.endpoint ?? LINEAR_REVOKE_ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: options.token, token_type_hint: options.tokenTypeHint }),
      },
    );
  } catch {
    throw new OAuthTokenError(
      "Unable to reach Linear's OAuth revocation endpoint.",
      undefined,
      "network",
    );
  }
  if (response.ok) return "revoked";
  if (response.status === 400 || response.status === 401) return "already-revoked";
  throw new OAuthTokenError(
    `Linear OAuth revocation failed (HTTP ${response.status}).`,
    response.status,
  );
}

/** Hosted app actor lifecycle: client secret stays with the host and tokens stay in memory. */
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
    const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_OAUTH_REFRESH_SKEW_MS;
    if (!Number.isFinite(refreshSkewMs) || refreshSkewMs < 0) {
      throw new OAuthTokenError("OAuth refresh skew must be a non-negative finite number.");
    }
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#scopes = [...new Set(options.scopes)];
    this.#refreshSkewMs = refreshSkewMs;
    this.#tokenEndpoint = options.tokenEndpoint ?? LINEAR_TOKEN_ENDPOINT;
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

  invalidate(): void {
    this.#cached = undefined;
  }

  #shouldRefresh(token: OAuthAccessToken): boolean {
    const lifetimeMs = token.expiresIn * 1000;
    return this.#now() >= token.expiresAt - Math.min(this.#refreshSkewMs, lifetimeMs / 2);
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
      throw new OAuthTokenError(
        "Unable to reach Linear's OAuth token endpoint.",
        undefined,
        "network",
      );
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
      accessToken: token.accessToken,
      expiresAt: this.#now() + token.expiresIn * 1000,
      expiresIn: token.expiresIn,
      scope: token.scope,
      tokenType: token.tokenType,
    };
  }
}
