/**
 * Interactive prompt helpers. Every prompt is TTY-gated: when stdin is not a
 * TTY (or --no-input / --yes was passed) prompting is refused with a usage
 * error so the CLI never hangs in scripts.
 */

import { confirm as inquirerConfirm, input as inquirerInput, select as inquirerSelect } from "@inquirer/prompts";
import { usageError } from "./errors.js";
import type { Context } from "../context.js";

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
  return inquirerConfirm({ message, default: false });
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

export async function promptSelect<T>(
  ctx: Context,
  message: string,
  choices: Array<{ name: string; value: T }>,
): Promise<T> {
  ensureInteractive(ctx, message);
  return inquirerSelect({ message, choices });
}
