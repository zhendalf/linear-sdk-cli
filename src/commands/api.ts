/**
 * `linear api` — raw GraphQL escape hatch.
 *
 * Reaches any part of the Linear API the curated commands don't wrap. Accepts a
 * query/mutation as an argument, from --query-file, or from stdin; variables via
 * repeatable --var k=v, --vars '<json>', or --vars-file <path>; optional
 * --operation for multi-op documents; --paginate to auto-follow a connection's
 * cursor; --raw to print the full response (data + extensions).
 */

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { action } from "../lib/action.js";
import { withRetry } from "../client.js";
import { collectKeyVal } from "../lib/options.js";
import { readStdinSync } from "../lib/body.js";
import { usageError, CliError } from "../lib/errors.js";
import type { Context } from "../context.js";

export function registerApi(program: Command): void {
  program
    .command("api [query]")
    .description("Run a raw GraphQL query or mutation against the Linear API")
    .option("--query-file <path>", "read the query from a file ('-' for stdin)")
    .option("--var <k=v...>", "set a variable (repeatable; string value)", collectKeyVal, {})
    .option("--vars <json>", "variables as a JSON object")
    .option("--vars-file <path>", "read variables from a JSON file ('-' for stdin)")
    .option("--operation <name>", "operation name for a multi-operation document")
    .option("--paginate", "auto-follow the first connection's pageInfo cursor")
    .option("--raw", "print the full GraphQL response (data + extensions)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear api '{ viewer { id name } }'",
        "  linear api 'query($id:String!){ issue(id:$id){ title } }' --var id=TES-1",
        "  echo '{ teams { nodes { key name } } }' | linear api --query-file -",
        "  linear api --query-file q.graphql --vars-file vars.json --paginate",
      ].join("\n"),
    )
    .action(
      action(async (ctx: Context, opts, queryArg?: string) => {
        const query = resolveQuery(queryArg, opts.queryFile);
        const variables = resolveVariables(opts);

        if (opts.paginate) {
          const { nodes, pageCount } = await paginate(ctx, query, variables, opts.operation);
          // Contract: stdout is a bare array; pagination metadata goes to stderr.
          ctx.output.info(`fetched ${nodes.length} node(s) across ${pageCount} page(s)`);
          ctx.output.emit(nodes, () => process.stdout.write(JSON.stringify(nodes, null, 2) + "\n"));
          return;
        }

        const result: any = await withRetry(() =>
          (ctx.client.client as any).rawRequest(query, variables, undefined, opts.operation),
        );
        const payload = opts.raw
          ? { data: result.data, extensions: result.extensions }
          : result.data;
        ctx.output.emit(payload, () =>
          process.stdout.write(JSON.stringify(payload, null, 2) + "\n"),
        );
      }),
    );
}

function readFileOrThrow(path: string, label: string): string {
  if (path === "-") return readStdinSync();
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw usageError(`Cannot read ${label} '${path}': ${(err as Error).message}`);
  }
}

function resolveQuery(arg: string | undefined, file: string | undefined): string {
  let query: string | undefined;
  if (arg !== undefined) query = arg;
  else if (file !== undefined) query = readFileOrThrow(file, "--query-file");
  else if (!process.stdin.isTTY) query = readStdinSync();

  query = query?.trim();
  if (!query) throw usageError("No GraphQL query provided (argument, --query-file, or stdin).");
  return query;
}

function resolveVariables(opts: Record<string, any>): Record<string, unknown> {
  let vars: Record<string, unknown> = {};
  if (opts.varsFile) {
    const text = readFileOrThrow(opts.varsFile, "--vars-file");
    vars = { ...vars, ...parseJsonObject(text, "--vars-file") };
  }
  if (opts.vars) vars = { ...vars, ...parseJsonObject(opts.vars, "--vars") };
  if (opts.var) vars = { ...vars, ...(opts.var as Record<string, string>) };
  return vars;
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw usageError(`${label} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw usageError(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Best-effort pagination: repeatedly run the query injecting `after`, find the
 * first `{ nodes, pageInfo }` connection in the result, and concatenate nodes.
 * The supplied query must accept an `$after: String` variable.
 */
async function paginate(
  ctx: Context,
  query: string,
  variables: Record<string, unknown>,
  operation: string | undefined,
): Promise<{ nodes: unknown[]; pageCount: number }> {
  let after: string | undefined = variables.after as string | undefined;
  let firstData: any;
  const allNodes: unknown[] = [];
  let pages = 0;

  for (;;) {
    const result: any = await withRetry(() =>
      (ctx.client.client as any).rawRequest(query, { ...variables, after }, undefined, operation),
    );
    if (!firstData) firstData = result.data;
    const conn = findConnection(result.data);
    if (!conn) {
      if (pages === 0) throw new CliError("No connection (nodes/pageInfo) found to paginate.", "usage");
      break;
    }
    allNodes.push(...conn.nodes);
    pages++;
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) break;
    after = conn.pageInfo.endCursor as string;
    if (pages > 1000) break; // safety bound
  }

  return { nodes: allNodes, pageCount: pages };
}

/** Find the first `{ nodes, pageInfo }` connection anywhere in the response. Exported for tests. */
export function findConnection(data: any): { nodes: unknown[]; pageInfo: any } | undefined {
  if (!data || typeof data !== "object") return undefined;
  if (Array.isArray((data as any).nodes) && (data as any).pageInfo) {
    return data as { nodes: unknown[]; pageInfo: any };
  }
  for (const value of Object.values(data)) {
    const found = findConnection(value);
    if (found) return found;
  }
  return undefined;
}
