/**
 * `linear api` — raw GraphQL escape hatch.
 *
 * Reaches any part of the Linear API the curated commands don't wrap. Accepts a
 * query/mutation as an argument, from --query-file, or from stdin; variables via
 * repeatable --var k=v, --vars '<json>', or --vars-file <path>; --operation to
 * pick one operation out of a multi-operation document; --paginate to
 * auto-follow a connection's cursor; --raw to print the full response
 * (data + extensions).
 */

import { Command } from "commander";
import { readFileSync } from "node:fs";
import {
  Kind,
  parse as parseGraphQL,
  print as printGraphQL,
  visit,
  type DocumentNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
} from "graphql";
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
    .option("--operation <name>", "run this operation of a multi-operation document")
    .option("--paginate", "auto-follow the first connection's pageInfo cursor (queries only)")
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
        "  linear api --query-file ops.graphql --operation Second",
      ].join("\n"),
    )
    .action(action(runApi));
}

/**
 * The `api` action body, exported so tests can drive it against a fake client
 * and assert on exactly what reaches `rawRequest`.
 */
export async function runApi(
  ctx: Context,
  opts: Record<string, any>,
  queryArg?: string,
): Promise<void> {
  const source = resolveQuery(queryArg, opts.queryFile);
  const variables = resolveVariables(opts);
  // --operation and --paginate both need a parsed document: one to pick an
  // operation out of it, the other to refuse anything that is not a query.
  const doc = prepareDocument(source, opts.operation, {
    mustParse: Boolean(opts.operation) || Boolean(opts.paginate),
  });

  if (opts.paginate) {
    if (doc.operation !== "query") {
      throw usageError(
        `--paginate re-runs the document once per page, so it only accepts a query; this document is a ${doc.operation}. Re-running a ${doc.operation} would repeat its side effects on every page.`,
      );
    }
    const { nodes, pageCount, truncated } = await paginate(ctx, doc.query, variables);
    // Contract: stdout is a bare array; pagination metadata goes to stderr.
    ctx.output.info(`fetched ${nodes.length} node(s) across ${pageCount} page(s)`);
    if (truncated)
      ctx.output.warn(`result truncated at the ${PAGE_CAP}-page safety cap; more pages may exist`);
    ctx.output.emit(nodes, () => process.stdout.write(JSON.stringify(nodes, null, 2) + "\n"));
    return;
  }

  const result: any = await withRetry(() =>
    (ctx.client.client as any).rawRequest(doc.query, variables),
  );
  const payload = opts.raw ? { data: result.data, extensions: result.extensions } : result.data;
  ctx.output.emit(payload, () => process.stdout.write(JSON.stringify(payload, null, 2) + "\n"));
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
 * The document we will actually send, plus what we learned by parsing it.
 *
 * `operation` is the kind (`query`/`mutation`/`subscription`) of the operation
 * that will run, or `undefined` when the document could not be parsed and we
 * are deferring to the server (only possible when neither --operation nor
 * --paginate was asked for).
 */
export interface PreparedDocument {
  query: string;
  operation: "query" | "mutation" | "subscription" | undefined;
  operationName?: string;
}

/**
 * Resolve which operation of a document will run.
 *
 * The SDK's `rawRequest(query, variables, headers)` has no `operationName`
 * parameter and its request body carries only `{query, variables}`, so the only
 * way to select one operation out of many is to *send only that one*: we parse
 * the document and print a new one containing the chosen operation plus the
 * fragments it (transitively) uses. A single-operation document is sent
 * verbatim, so formatting, comments and any syntax our parser merely tolerates
 * survive untouched.
 */
export function prepareDocument(
  source: string,
  requested: string | undefined,
  { mustParse }: { mustParse: boolean },
): PreparedDocument {
  let doc: DocumentNode;
  try {
    doc = parseGraphQL(source);
  } catch (err) {
    // The escape hatch should not become less capable than the server it wraps:
    // when nothing depends on our understanding of the document, send it as-is
    // and let the API be the authority on what is valid.
    if (!mustParse) return { query: source, operation: undefined };
    throw usageError(`Cannot parse the GraphQL document: ${(err as Error).message}`);
  }

  const operations = doc.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );
  if (operations.length === 0) {
    throw usageError("The GraphQL document defines no operation to run.");
  }

  let selected: OperationDefinitionNode;
  if (requested !== undefined) {
    const match = operations.find((o) => o.name?.value === requested);
    if (!match) throw usageError(unknownOperationMessage(requested, operations));
    selected = match;
  } else if (operations.length === 1) {
    selected = operations[0]!;
  } else {
    throw usageError(
      `The document defines ${operations.length} operations (${describeNames(operations)}); pass --operation <name> to choose one.`,
    );
  }

  const result: PreparedDocument = {
    query: source,
    operation: selected.operation,
    operationName: selected.name?.value,
  };
  // Only rewrite when the document really holds more than one operation —
  // otherwise what we send is byte-for-byte what the user wrote.
  if (operations.length > 1) {
    result.query = printGraphQL({
      kind: Kind.DOCUMENT,
      definitions: [selected, ...reachableFragments(doc, selected)],
    });
  }
  return result;
}

function describeNames(operations: OperationDefinitionNode[]): string {
  return operations.map((o) => o.name?.value ?? "<unnamed>").join(", ");
}

function unknownOperationMessage(
  requested: string,
  operations: OperationDefinitionNode[],
): string {
  const named = operations.filter((o) => o.name).map((o) => o.name!.value);
  const available = named.length
    ? `Available: ${named.join(", ")}.`
    : "The document's only operation is unnamed.";
  return `No operation named '${requested}' in the document. ${available}`;
}

/** Every fragment definition the operation depends on, following spreads transitively. */
function reachableFragments(
  doc: DocumentNode,
  operation: OperationDefinitionNode,
): FragmentDefinitionNode[] {
  const defined = new Map<string, FragmentDefinitionNode>();
  for (const def of doc.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) defined.set(def.name.value, def);
  }
  const needed = new Map<string, FragmentDefinitionNode>();
  const queue: Array<OperationDefinitionNode | FragmentDefinitionNode> = [operation];
  while (queue.length > 0) {
    visit(queue.pop()!, {
      FragmentSpread(spread) {
        const name = spread.name.value;
        if (needed.has(name)) return;
        const fragment = defined.get(name);
        // A spread with no definition is left dangling for the server to reject
        // — the same answer the user would get without --operation.
        if (!fragment) return;
        needed.set(name, fragment);
        queue.push(fragment);
      },
    });
  }
  return [...needed.values()];
}

/**
 * Best-effort pagination: repeatedly run the query injecting `after`, find the
 * first `{ nodes, pageInfo }` connection in the result, and concatenate nodes.
 * The supplied query must accept an `$after: String` variable.
 */
const PAGE_CAP = 1000;

async function paginate(
  ctx: Context,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ nodes: unknown[]; pageCount: number; truncated: boolean }> {
  let after: string | undefined = variables.after as string | undefined;
  let firstData: any;
  const allNodes: unknown[] = [];
  let pages = 0;
  let truncated = false;

  for (;;) {
    const result: any = await withRetry(() =>
      (ctx.client.client as any).rawRequest(query, { ...variables, after }),
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
    if (pages >= PAGE_CAP) {
      truncated = true; // safety bound hit; more pages may exist
      break;
    }
  }

  return { nodes: allNodes, pageCount: pages, truncated };
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
