/**
 * Interactive prompt helpers. Every prompt is TTY-gated: when stdin is not a
 * TTY (or --no-input / --yes was passed) prompting is refused with a usage
 * error so the CLI never hangs in scripts.
 */

import {
  confirm as inquirerConfirm,
  input as inquirerInput,
  password as inquirerPassword,
  select as inquirerSelect,
} from "@inquirer/prompts";
import { usageError } from "./errors.js";
import type { Context } from "../context.js";

/**
 * Exit code for "the user declined a confirmation prompt".
 *
 * Deliberately outside the 0–5 range of `ExitCode` (lib/errors.ts): declining
 * is neither success nor any of the failures, and a script needs to tell the
 * three apart. Kept next to the prompt that produces it; see `ExitCode` for the
 * rest of the table.
 */
export const EXIT_CANCELLED = 6;

export function ensureInteractive(ctx: Context, what: string): void {
  if (!ctx.isTTY) {
    throw usageError(`${what} requires interactive input; provide it via flags or run in a TTY.`);
  }
}

export async function confirmDestructive(ctx: Context, message: string): Promise<boolean> {
  if (ctx.options.yes) return true;
  if (!ctx.isTTY) {
    throw usageError(`Refusing destructive action without confirmation; pass --yes. (${message})`);
  }
  if (await inquirerConfirm({ message, default: false })) return true;
  // Every gated command answers `false` with a bare `return`, so before this the
  // decline produced exit 0 and no output at all — indistinguishable from a
  // successful delete, which made `linear issue delete X && rm …` run the `&&`
  // side after the user had just said no. The receipt and the exit code are
  // emitted here rather than at each of the ~14 call sites precisely so they
  // cannot drift apart between commands.
  ctx.output.cancelled(message);
  process.exitCode = EXIT_CANCELLED;
  return false;
}

export async function promptInput(
  ctx: Context,
  message: string,
  opts: { required?: boolean; default?: string } = {},
): Promise<string> {
  ensureInteractive(ctx, message);
  return inquirerInput({
    message,
    default: opts.default,
    validate: (v) => (opts.required && !v.trim() ? "Required" : true),
  });
}

/**
 * Prompt for a secret.
 *
 * `promptInput` echoes, which for an API key means the credential is on screen
 * during entry and then in the terminal's scrollback for as long as the user
 * keeps that window — recoverable by anything that can read it, and easy to
 * paste into a screenshot or a bug report by accident. inquirer's `password`
 * prompt reads the same value without rendering it.
 */
export async function promptSecret(
  ctx: Context,
  message: string,
  opts: { required?: boolean } = {},
): Promise<string> {
  ensureInteractive(ctx, message);
  return inquirerPassword({
    message,
    mask: true,
    validate: (v) => (opts.required && !v.trim() ? "Required" : true),
  });
}

export async function promptSelect<T>(
  ctx: Context,
  message: string,
  choices: Array<{ name: string; value: T }>,
): Promise<T> {
  ensureInteractive(ctx, message);
  return inquirerSelect({ message, choices });
}
