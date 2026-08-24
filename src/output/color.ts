/**
 * Resolve terminal colour and debug policy in one place. Both the per-command
 * Context and the top-level error boundary use these helpers, so a parse-time
 * failure behaves exactly like an API result.
 */

export interface ColorPolicy {
  /** An explicit CLI opt-out (`--no-ansi` / `--no-color`). */
  disabled?: boolean;
  /** JSON is a byte-oriented machine format and never carries terminal ANSI. */
  json?: boolean;
  /** TTY state of the stream that will receive the text. */
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
}

/** Values conventionally used to turn a forcing variable off. */
function isFalse(value: string): boolean {
  return value === "0" || value.toLowerCase() === "false";
}

/**
 * Whether human output should contain ANSI colour.
 *
 * Precedence is deliberately conservative:
 *
 *   CLI opt-out / JSON > NO_COLOR > FORCE_COLOR > CLICOLOR_FORCE > TTY
 *
 * `FORCE_COLOR=0` is also an explicit opt-out, matching the convention used by
 * Node tooling. `CLICOLOR_FORCE=0` merely means "do not force". This lets a
 * caller keep colour while stdout is connected to a pager without ever
 * putting ANSI into JSON.
 */
export function shouldUseColor(policy: ColorPolicy): boolean {
  if (policy.disabled === true || policy.json === true) return false;

  const env = policy.env ?? process.env;
  if (env.NO_COLOR !== undefined) return false;

  if (env.FORCE_COLOR !== undefined) {
    return !isFalse(env.FORCE_COLOR);
  }
  if (env.CLICOLOR_FORCE !== undefined && !isFalse(env.CLICOLOR_FORCE)) return true;

  return policy.isTTY === true;
}

/** `--debug` and LINEAR_DEBUG are equivalent, with the flag always additive. */
export function isDebugEnabled(explicit: boolean | undefined, env = process.env): boolean {
  const value = env.LINEAR_DEBUG?.toLowerCase();
  return explicit === true || value === "1" || value === "true";
}
