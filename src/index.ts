/**
 * Programmatic entry point. Lets the CLI be embedded/tested without spawning.
 */

export { createProgram, VERSION } from "./cli.js";
export { Context } from "./context.js";
export { resolveConfig, type ResolvedConfig } from "./config.js";
export { createClient } from "./client.js";
export {
  DEFAULT_OAUTH_CALLBACK_TIMEOUT_MS,
  DEFAULT_OAUTH_REFRESH_SKEW_MS,
  DEFAULT_OAUTH_SCOPES,
  ClientCredentialsTokenProvider,
  OAuthUserTokenProvider,
  OAuthTokenError,
  buildAuthorizationUrl,
  createPkceRequest,
  exchangeAuthorizationCode,
  revokeOAuthToken,
  startLoopbackCallback,
  type ClientCredentialsTokenProviderOptions,
  type GetAccessTokenOptions,
  type OAuthAccessToken,
  type OAuthUserCredential,
  type OAuthUserTokenProviderOptions,
  type PkceRequest,
} from "./oauth.js";
export { CliError, ExitCode, normalizeError } from "./lib/errors.js";
export { branchToIssueId, currentIssueId } from "./git.js";
