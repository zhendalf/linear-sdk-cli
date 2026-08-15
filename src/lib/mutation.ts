/**
 * Mutation payload unwrapping — the one place that decides a mutation worked.
 *
 * Every Linear mutation answers with a payload carrying a non-null
 * `success: Boolean!`; most also carry the entity they touched
 * (`{ success, issue }`, `{ success, projectMilestone }`, …) while a few carry
 * nothing but bookkeeping (`{ success, lastSyncId }` — deletes, archives,
 * subscribe/unsubscribe, notification updates). A service that ignores
 * `success`, or that substitutes the pre-mutation entity when the payload has
 * none, reports a success it never checked: the CLI prints `Updated TES-1` and
 * exits 0 while nothing changed. Both forms go through here instead.
 *
 * `success: false` is the API refusing the write, not the user mistyping, so it
 * is an `api` error (exit 1 — runtime), not a usage error (exit 2).
 */

import { CliError } from "./errors.js";

/** The shape every Linear mutation payload has in common. */
export interface MutationPayload {
  success: boolean;
}

const failed = (action: string, why: string) => new CliError(`${action} failed: ${why}.`, "api");

/**
 * Assert that a mutation reported success, for the payloads that carry no
 * entity of their own. Returns the payload so a caller can read `lastSyncId`.
 */
export async function assertMutation<P extends MutationPayload>(
  payload: P | Promise<P>,
  action: string,
): Promise<P> {
  const p = await payload;
  if (p?.success !== true) throw failed(action, "the API reported success: false");
  return p;
}

/**
 * Assert success *and* return the entity the payload is supposed to carry.
 * A missing entity on a successful payload is still a failure — we have nothing
 * to report back, and the pre-mutation entity would be a lie.
 */
export async function unwrapMutation<P extends MutationPayload, K extends keyof P>(
  payload: P | Promise<P>,
  key: K,
  action: string,
): Promise<NonNullable<Awaited<P[K]>>> {
  const p = await assertMutation(payload, action);
  const entity = await p[key];
  if (entity == null) throw failed(action, `the API returned no ${String(key)}`);
  return entity as NonNullable<Awaited<P[K]>>;
}
