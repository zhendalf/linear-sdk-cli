/**
 * Discovery commands for agents and scripts:
 *   - `linear commands` — a machine-readable tree of every (sub)command.
 *   - `linear schema`   — the Linear GraphQL schema as SDL (or raw introspection
 *     with --json). `-o <file>` chooses the destination for either format.
 *
 * Both are registered last (in cli.ts) so they can introspect the full program.
 */

import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { buildClientSchema, getIntrospectionQuery, printSchema } from "graphql";
import { action } from "../lib/action.js";
import { withRetry } from "../client.js";
import { walkCommands, type CommandNode } from "../lib/introspect.js";
import { renderOutputShape } from "../lib/shape.js";
import { usageError, notFound, CliError } from "../lib/errors.js";
import type { Context } from "../context.js";

/**
 * `linear commands [path...]` — the command tree (bare array in --json), or one
 * command by path (bare object) with its options and, since TES-610, the shape
 * of what it prints under `--json`: `linear commands issue list --json | jq
 * .output.fields` says a row has `.state.name` before anything is run.
 */
export function registerCommands(program: Command): void {
  program
    .command("commands [path...]")
    .description("List every command in a machine-readable tree, or describe one (for scripts/agents)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear commands --json | jq -r '.[].path'",
        "  linear commands issue list                       # options + the --json row shape",
        "  linear commands issue view --json | jq '.output.fields'",
        "  linear commands --json | jq '.[] | select(.output.kind==\"list\") | .path'",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, _opts, pathWords: string[] = []) => {
        const nodes = walkCommands(program);
        if (pathWords.length === 0) {
          // Bare array in --json; a compact indented listing otherwise.
          ctx.output.emit(nodes, () => renderTree(ctx, nodes));
          return;
        }
        const path = pathWords.join(" ");
        const node = nodes.find((n) => n.path === path);
        if (!node) {
          const near = nodes.filter((n) => n.path.startsWith(path)).map((n) => n.path);
          throw notFound(
            `No command '${path}'.${near.length ? ` Did you mean: ${near.slice(0, 5).join(", ")}?` : " Try 'linear commands' for the list."}`,
          );
        }
        // One command → a bare object in --json (its `output` is the shape a
        // script wants), a full description otherwise.
        ctx.output.emit(node, () => {
          renderOne(ctx, node);
          const children = nodes.filter((n) => n.path.startsWith(`${path} `));
          if (children.length) {
            ctx.output.line();
            ctx.output.line("Subcommands:");
            renderTree(ctx, children, path.split(" ").length);
          }
        });
      }),
    );
}

/** `<id> [extra...]` from a node's arguments. */
function usageArgs(n: CommandNode): string {
  return n.arguments
    .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`) + (a.variadic ? "..." : ""))
    .join(" ");
}

function renderTree(ctx: Context, nodes: CommandNode[], baseDepth = 0): void {
  for (const n of nodes) {
    const depth = n.path.split(" ").length - 1 - baseDepth;
    const indent = "  ".repeat(depth);
    const head = [n.path, usageArgs(n)].filter(Boolean).join(" ");
    const alias = n.aliases.length ? ` (${n.aliases.join(", ")})` : "";
    ctx.output.line(`${indent}${head}${alias}`);
    if (n.description) ctx.output.line(`${indent}  ${n.description}`);
  }
}

/** One command in full: usage, aliases, options, and the `--json` output shape. */
function renderOne(ctx: Context, n: CommandNode): void {
  ctx.output.line(`Usage: linear ${[n.path, n.options.length ? "[options]" : "", usageArgs(n)].filter(Boolean).join(" ")}`);
  if (n.description) ctx.output.line(`  ${n.description}`);
  if (n.aliases.length) ctx.output.line(`Aliases: ${n.aliases.join(", ")}`);
  if (n.options.length) {
    ctx.output.line();
    ctx.output.line("Options:");
    const width = Math.max(...n.options.map((o) => o.flags.length));
    for (const o of n.options) ctx.output.line(`  ${o.flags.padEnd(width)}  ${o.description}`);
  }
  ctx.output.line();
  if (n.output) {
    const [head, ...rest] = renderOutputShape(n.output);
    ctx.output.line(`Output (--json): ${head}`);
    for (const line of rest) ctx.output.line(line);
  } else {
    ctx.output.line("Output (--json): none of its own (see its subcommands)");
  }
}

/** `linear schema` — dump the GraphQL schema as SDL (or raw introspection). */
export function registerSchema(program: Command): void {
  program
    .command("schema")
    .description("Print the Linear GraphQL schema as SDL (--json prints raw introspection)")
    .option("-o, --output <file>", "write to a file instead of stdout")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear schema -o /tmp/linear.graphql && grep 'type Issue' /tmp/linear.graphql",
        "  linear schema | less",
        "  linear schema --json | jq '.__schema.types | length'",
        "  linear schema --json -o /tmp/introspection.json",
      ].join("\n"),
    )
    .action(action(runSchema));
}

/** The `schema` action body, exported so tests can drive it against a fake client. */
export async function runSchema(ctx: Context, opts: Record<string, any>): Promise<void> {
  const result: any = await withRetry(() =>
    (ctx.client.client as any).rawRequest(getIntrospectionQuery()),
  );
  const introspection = result.data;
  if (!introspection) throw usageError("Introspection returned no schema data.");

  // Format and destination are independent: --json picks the format, -o picks
  // where it lands. (The JSON branch used to return before reaching the write,
  // so `--json -o file` printed to stdout and left no file.)
  const json = ctx.output.json;
  if (opts.output) {
    const body = json
      ? JSON.stringify(introspection, null, 2)
      : printSchema(buildClientSchema(introspection));
    writeSchemaFile(opts.output, body + "\n");
    ctx.output.success(`Wrote ${json ? "introspection JSON" : "schema"} to ${opts.output}`);
    return;
  }

  if (json) {
    // Raw introspection result — bare object on stdout.
    ctx.output.emit(introspection, () => {});
    return;
  }
  ctx.output.line(printSchema(buildClientSchema(introspection)));
}

function writeSchemaFile(path: string, body: string): void {
  try {
    writeFileSync(path, body, "utf8");
  } catch (err) {
    throw new CliError(`Cannot write to '${path}': ${(err as Error).message}`, "runtime");
  }
}
