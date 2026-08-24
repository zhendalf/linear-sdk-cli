/**
 * Walk a commander program tree into a flat, machine-readable description of
 * every (sub)command — used by `linear commands` for discovery by agents.
 */

import type { Command } from "commander";
import type { OutputShape } from "./shape.js";
import { outputShapeOf } from "./output-shapes.js";
import {
  FIELDS_COMMANDS,
  LIMIT_COMMANDS,
  TEAM_COMMANDS,
  YES_COMMANDS,
  globalOptionKeys,
} from "./options.js";

export interface CommandArgument {
  name: string;
  required: boolean;
  variadic: boolean;
}

export interface CommandOption {
  flags: string;
  description: string;
  /** Commander's destination key (e.g. `includeArchived`). */
  attribute: string;
  /** Whether the option's value is required/optional after the flag. */
  valueRequired: boolean;
  valueOptional: boolean;
  variadic: boolean;
  choices?: string[];
  defaultValue?: unknown;
  /** True for the flags inherited from the root CLI contract. */
  global: boolean;
  /** Whether this global has an effect on this command. Local options are always applicable. */
  applicable: boolean;
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
  const args: CommandArgument[] =
    (cmd as any).registeredArguments?.map((a: any) => ({
      name: a.name(),
      required: a.required === true,
      variadic: a.variadic === true,
    })) ?? [];

  const joined = path.join(" ");
  const defaultName = (cmd as any)._defaultCommandName as string | undefined;
  const effectivePath = defaultName ? `${joined} ${defaultName}` : joined;
  const runnable = Boolean((cmd as any)._actionHandler) || defaultName !== undefined;
  const globalKeys = new Set(globalOptionKeys());
  const options: CommandOption[] = cmd.options
    .filter((o: any) => !o.hidden)
    .map((o: any) => {
      const attribute = o.attributeName() as string;
      const global = globalKeys.has(attribute) && isGlobalFlag(o.long);
      return {
        flags: o.flags as string,
        description: (o.description as string) ?? "",
        attribute,
        valueRequired: o.required === true,
        valueOptional: o.optional === true,
        variadic: o.variadic === true,
        ...(Array.isArray(o.argChoices) ? { choices: [...o.argChoices] as string[] } : {}),
        ...(o.defaultValue !== undefined ? { defaultValue: o.defaultValue as unknown } : {}),
        global,
        applicable: global ? globalApplies(effectivePath, o.long, runnable) : true,
      };
    });

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

const GLOBAL_LONGS = new Set([
  "--json",
  "--no-ansi",
  "--api-key",
  "--workspace",
  "--team",
  "--limit",
  "--all",
  "--fields",
  "--yes",
  "--quiet",
  "--no-input",
  "--debug",
]);

function isGlobalFlag(long: string | undefined): boolean {
  return long !== undefined && GLOBAL_LONGS.has(long);
}

function globalApplies(path: string, long: string | undefined, hasAction: boolean): boolean {
  if (!hasAction) return false;
  if (long === "--fields") return FIELDS_COMMANDS.has(path);
  if (long === "--limit" || long === "--all") return LIMIT_COMMANDS.has(path);
  if (long === "--team") return TEAM_COMMANDS.has(path);
  if (long === "--yes") return YES_COMMANDS.has(path);
  // The remaining globals control the shared parser/context/error/output
  // boundary and are intentionally safe on every runnable command.
  return true;
}
