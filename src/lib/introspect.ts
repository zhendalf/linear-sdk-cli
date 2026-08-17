/**
 * Walk a commander program tree into a flat, machine-readable description of
 * every (sub)command — used by `linear commands` for discovery by agents.
 */

import type { Command } from "commander";
import type { OutputShape } from "./shape.js";
import { outputShapeOf } from "./output-shapes.js";

export interface CommandArgument {
  name: string;
  required: boolean;
  variadic: boolean;
}

export interface CommandOption {
  flags: string;
  description: string;
}

export interface CommandNode {
  /** Space-joined command path, e.g. "issue create". */
  path: string;
  description: string;
  aliases: string[];
  arguments: CommandArgument[];
  options: CommandOption[];
  /**
   * What the command prints under `--json` (TES-610): the row/object keys with
   * their types, from `lib/output-shapes.ts`. Absent on a group that only holds
   * subcommands and prints nothing of its own.
   */
  output?: OutputShape;
}

/**
 * Produce a flat array of command nodes for `root` and all descendants. The
 * root program itself is skipped; only its (sub)commands are emitted. Help and
 * version pseudo-options are omitted from each command's option list. Sorted by
 * path for stable output.
 */
export function walkCommands(root: Command): CommandNode[] {
  const out: CommandNode[] = [];

  const visit = (cmd: Command, prefix: string[]): void => {
    for (const sub of cmd.commands) {
      // Commander models help as a hidden command; skip it.
      if (sub.name() === "help") continue;
      const path = [...prefix, sub.name()];
      out.push(describe(sub, path));
      visit(sub, path);
    }
  };

  visit(root, []);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function describe(cmd: Command, path: string[]): CommandNode {
  const args: CommandArgument[] = (cmd as any).registeredArguments?.map((a: any) => ({
    name: a.name(),
    required: a.required === true,
    variadic: a.variadic === true,
  })) ?? [];

  const options: CommandOption[] = cmd.options
    .filter((o: any) => !o.hidden)
    .map((o: any) => ({ flags: o.flags as string, description: (o.description as string) ?? "" }));

  const joined = path.join(" ");
  const output = outputShapeOf(joined);
  return {
    path: joined,
    description: cmd.description() ?? "",
    aliases: cmd.aliases(),
    arguments: args,
    options,
    ...(output ? { output } : {}),
  };
}
