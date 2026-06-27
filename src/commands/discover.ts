/**
 * Discovery commands for agents and scripts:
 *   - `linear commands` — a machine-readable tree of every (sub)command.
 *   - `linear schema`   — the Linear GraphQL schema as SDL (or raw introspection).
 *
 * Both are registered last (in cli.ts) so they can introspect the full program.
 */

import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { buildClientSchema, getIntrospectionQuery, printSchema } from "graphql";
import { action } from "../lib/action.js";
import { withRetry } from "../client.js";
import { walkCommands, type CommandNode } from "../lib/introspect.js";
import { usageError } from "../lib/errors.js";
import type { Context } from "../context.js";

/** `linear commands` — emit the command tree (bare array in --json). */
export function registerCommands(program: Command): void {
  program
    .command("commands")
    .description("List every command in a machine-readable tree (for scripts/agents)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear commands --json | jq -r '.[].path'",
        "  linear commands",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context) => {
        const nodes = walkCommands(program);
        // Bare array in --json; a compact indented listing otherwise.
        ctx.output.emit(nodes, () => renderHuman(ctx, nodes));
      }),
    );
}

function renderHuman(ctx: Context, nodes: CommandNode[]): void {
  for (const n of nodes) {
    const depth = n.path.split(" ").length - 1;
    const indent = "  ".repeat(depth);
    const argStr = n.arguments
      .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`) + (a.variadic ? "..." : ""))
      .join(" ");
    const head = [n.path, argStr].filter(Boolean).join(" ");
    const alias = n.aliases.length ? ` (${n.aliases.join(", ")})` : "";
    ctx.output.line(`${indent}${head}${alias}`);
    if (n.description) ctx.output.line(`${indent}  ${n.description}`);
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
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts) => {
        const result: any = await withRetry(() =>
          (ctx.client.client as any).rawRequest(getIntrospectionQuery()),
        );
        const introspection = result.data;
        if (!introspection) throw usageError("Introspection returned no schema data.");

        if (ctx.output.json) {
          // Raw introspection result — bare object on stdout.
          ctx.output.emit(introspection, () => {});
          return;
        }

        const sdl = printSchema(buildClientSchema(introspection));
        if (opts.output) {
          writeFileSync(opts.output, sdl + "\n", "utf8");
          ctx.output.success(`Wrote schema to ${opts.output}`);
        } else {
          ctx.output.line(sdl);
        }
      }),
    );
}
