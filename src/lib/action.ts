/**
 * Wrap a command handler so it receives a built Context, the command's local
 * options, and positionals — in that order. Errors propagate to the central
 * boundary in bin/linear.ts.
 *
 * Commander invokes actions as (...positionals, localOpts, command).
 */

import type { Command } from "commander";
import { Context, type GlobalOptions } from "../context.js";

export type ActionHandler = (
  ctx: Context,
  opts: Record<string, any>,
  ...positionals: any[]
) => Promise<void> | void;

export function action(handler: ActionHandler) {
  return async (...args: any[]): Promise<void> => {
    const command = args[args.length - 1] as Command;
    const localOpts = (args[args.length - 2] ?? {}) as Record<string, any>;
    const positionals = args.slice(0, -2);
    const ctx = new Context(command.optsWithGlobals() as GlobalOptions);
    // Repair and discovery commands must remain usable without selecting credentials.
    let group = command;
    while (group.parent?.parent) group = group.parent;
    const offline =
      ["config", "commands", "schema", "completion"].includes(group.name()) ||
      (group.name() === "auth" && !["whoami", "status", "token"].includes(command.name()));
    if (!offline) await ctx.selectWorkspace();
    await handler(ctx, localOpts, ...positionals);
  };
}
