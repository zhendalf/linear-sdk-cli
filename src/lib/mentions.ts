import type { LinearClient } from "@linear/sdk";
import { withRetry } from "../client.js";
import { usageError } from "./errors.js";
import { resolveUserId } from "./resolve.js";

/**
 * Prepend explicit Linear mentions to a Markdown body.
 *
 * Linear stores a real user mention as `@[label](user-id)`. Ordinary `@name`
 * text is deliberately not parsed: it is prose unless the caller also passes
 * `--mention <user>`. Keeping the intent in an option prevents an innocent
 * name in a pasted body from notifying somebody.
 */
export async function prependMentions(
  client: LinearClient,
  body: string,
  references: string[] = [],
): Promise<string> {
  if (references.length === 0) return body;

  const mentions: string[] = [];
  const seen = new Set<string>();
  for (const raw of references) {
    const reference = normalizeMentionReference(raw);
    const id = await resolveUserId(client, reference);
    if (seen.has(id)) continue;
    seen.add(id);

    const user = await withRetry(() => client.user(id));
    const label = escapeMentionLabel(user.displayName);
    mentions.push(`@[${label}](${id})`);
  }

  const prefix = mentions.join(" ");
  return body ? `${prefix}\n\n${body}` : prefix;
}

/** Accept the natural `@ada` spelling without confusing it with an email. */
export function normalizeMentionReference(raw: string): string {
  const reference = raw.trim();
  if (!reference) throw usageError("--mention requires a non-empty user reference.");
  if (reference.startsWith("@") && reference !== "@me") return reference.slice(1);
  return reference;
}

/** Escape the Markdown-link label without changing Linear's mention grammar. */
export function escapeMentionLabel(label: string): string {
  return label.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}
