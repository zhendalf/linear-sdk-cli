import { describe, it, expect, vi } from "bun:test";
import { findConnection, prepareDocument, runApi } from "../../src/commands/api.js";
import { Output } from "../../src/output/format.js";

describe("findConnection", () => {
  it("finds a top-level connection", () => {
    const data = { nodes: [1, 2], pageInfo: { hasNextPage: false } };
    expect(findConnection(data)?.nodes).toEqual([1, 2]);
  });

  it("finds a nested connection (e.g. data.issues)", () => {
    const data = { issues: { nodes: ["a"], pageInfo: { endCursor: "x" } } };
    expect(findConnection(data)?.nodes).toEqual(["a"]);
  });

  it("returns undefined when there is no connection", () => {
    expect(findConnection({ viewer: { id: "1" } })).toBeUndefined();
    expect(findConnection(null)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The seam under test is `client.client.rawRequest`, whose real signature is
// (query, variables?, requestHeaders?) — three parameters, no operationName.
// A faithful mock therefore records what a document-selection bug would show
// up in: the query text that actually goes over the wire.
// ---------------------------------------------------------------------------

interface Call {
  query: string;
  variables: Record<string, unknown> | undefined;
  argCount: number;
}

function harness(pages: unknown[] = [{ data: { viewer: { id: "u1" } } }]) {
  const calls: Call[] = [];
  let next = 0;
  const rawRequest = vi.fn((query: string, variables?: any, ...rest: unknown[]) => {
    calls.push({ query, variables, argCount: 2 + rest.length });
    const page = pages[Math.min(next, pages.length - 1)];
    next++;
    return Promise.resolve(page);
  });
  const ctx = {
    client: { client: { rawRequest } },
    output: new Output({ json: true, color: false, quiet: true, debug: false }),
  } as any;
  return { ctx, calls, rawRequest };
}

/** Swallow the JSON the command writes to stdout. */
function silently<T>(fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  return fn().finally(() => spy.mockRestore());
}

const TWO_OPS = `
  query First { viewer { id } }
  query Second { organization { name } }
`;

describe("api --operation", () => {
  it("sends ONLY the named operation, not the first one in the document", async () => {
    const { ctx, calls } = harness([{ data: { organization: { name: "acme" } } }]);
    await silently(() => runApi(ctx, { operation: "Second" }, TWO_OPS));

    expect(calls).toHaveLength(1);
    // The SDK has no operationName parameter, so selection can only work by
    // sending a single-operation document. Assert the other op is really gone.
    expect(calls[0]!.query).toContain("organization");
    expect(calls[0]!.query).not.toContain("viewer");
    expect(calls[0]!.query).toContain("query Second");
    expect(calls[0]!.query).not.toContain("query First");
  });

  it("passes no phantom 4th argument to rawRequest", async () => {
    const { ctx, calls } = harness();
    await silently(() => runApi(ctx, { operation: "Second" }, TWO_OPS));
    // rawRequest(query, variables, requestHeaders) — anything beyond variables
    // here was silently discarded, which is how --operation came to be inert.
    expect(calls[0]!.argCount).toBe(2);
  });

  it("carries along only the fragments the selected operation uses", async () => {
    const doc = `
      fragment TeamBits on Team { key }
      fragment UserBits on User { displayName }
      fragment NameBits on User { name }
      query Teams { teams { nodes { ...TeamBits } } }
      query Me { viewer { ...UserBits } }
      fragment UnusedBits on Issue { title }
    `;
    const { ctx, calls } = harness();
    await silently(() => runApi(ctx, { operation: "Me" }, doc));

    const sent = calls[0]!.query;
    expect(sent).toContain("fragment UserBits");
    expect(sent).not.toContain("fragment TeamBits");
    expect(sent).not.toContain("fragment UnusedBits");
    // NameBits is never spread, so it is not needed either.
    expect(sent).not.toContain("fragment NameBits");
  });

  it("follows fragment spreads transitively", () => {
    const doc = `
      fragment Outer on Issue { ...Inner }
      fragment Inner on Issue { ...Deepest }
      fragment Deepest on Issue { id }
      fragment Other on Issue { title }
      query A { issue { ...Outer } }
      query B { issue { ...Other } }
    `;
    const { query } = prepareDocument(doc, "A", { mustParse: true });
    expect(query).toContain("fragment Outer");
    expect(query).toContain("fragment Inner");
    expect(query).toContain("fragment Deepest");
    expect(query).not.toContain("fragment Other");
  });

  it("rejects an operation name the document does not define", () => {
    expect(() => prepareDocument(TWO_OPS, "Third", { mustParse: true })).toThrow(
      /No operation named 'Third'.*Available: First, Second/,
    );
  });

  it("refuses a multi-operation document when no operation is chosen", () => {
    expect(() => prepareDocument(TWO_OPS, undefined, { mustParse: false })).toThrow(
      /defines 2 operations \(First, Second\); pass --operation/,
    );
  });

  it("sends a single-operation document verbatim", async () => {
    const source = "  query First { viewer { id } }  ";
    const { ctx, calls } = harness();
    await silently(() => runApi(ctx, {}, source));
    // No reprinting: comments and formatting the user wrote survive untouched.
    expect(calls[0]!.query).toBe(source.trim());
  });

  it("still sends an unparseable document when nothing depends on parsing it", async () => {
    const weird = "query { viewer { id } } # @@ not-quite-graphql-we-know";
    const { query, operation } = prepareDocument(weird + "\n!!!", undefined, { mustParse: false });
    expect(query).toBe(weird + "\n!!!");
    expect(operation).toBeUndefined();
  });

  it("reports a parse error when --operation cannot be honored", () => {
    expect(() => prepareDocument("query {{{", "X", { mustParse: true })).toThrow(
      /Cannot parse the GraphQL document/,
    );
  });
});

describe("api --paginate operation kind guard", () => {
  const MUTATION = `
    mutation BulkCreate($after: String) {
      issueBatchCreate(input: {}) {
        issues { nodes { id } pageInfo { hasNextPage endCursor } }
      }
    }
  `;

  it("refuses to paginate a mutation WITHOUT sending it", async () => {
    const { ctx, rawRequest } = harness();
    await expect(silently(() => runApi(ctx, { paginate: true }, MUTATION))).rejects.toThrow(
      /only accepts a query; this document is a mutation/,
    );
    // The whole point: a re-run mutation would create duplicate entities, so
    // the guard must fire before the first request, not after.
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it("refuses to paginate a subscription", async () => {
    const { ctx, rawRequest } = harness();
    const sub =
      "subscription S($after: String) { issues { nodes { id } pageInfo { hasNextPage } } }";
    await expect(silently(() => runApi(ctx, { paginate: true }, sub))).rejects.toThrow(
      /this document is a subscription/,
    );
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it("refuses when the CHOSEN operation of a mixed document is a mutation", async () => {
    const mixed = `
      query Safe($after: String) { issues { nodes { id } pageInfo { hasNextPage } } }
      mutation Risky($after: String) { issueArchive { issues { nodes { id } pageInfo { hasNextPage } } } }
    `;
    const { ctx, rawRequest } = harness();
    await expect(
      silently(() => runApi(ctx, { paginate: true, operation: "Risky" }, mixed)),
    ).rejects.toThrow(/this document is a mutation/);
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it("still paginates a real query across pages", async () => {
    const { ctx, calls } = harness([
      { data: { issues: { nodes: ["a"], pageInfo: { hasNextPage: true, endCursor: "c1" } } } },
      { data: { issues: { nodes: ["b"], pageInfo: { hasNextPage: false } } } },
    ]);
    await silently(() =>
      runApi(
        ctx,
        { paginate: true },
        "query($after: String){ issues(after:$after){ nodes pageInfo{hasNextPage endCursor} } }",
      ),
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.variables).toEqual({ after: undefined });
    expect(calls[1]!.variables).toEqual({ after: "c1" });
    // The paginate loop had the same discarded-4th-argument bug.
    expect(calls[1]!.argCount).toBe(2);
  });

  it("paginates the selected operation of a multi-query document", async () => {
    const doc = `
      query Alpha($after: String) { issues(after:$after){ nodes pageInfo{hasNextPage} } }
      query Beta($after: String) { projects(after:$after){ nodes pageInfo{hasNextPage} } }
    `;
    const { ctx, calls } = harness([
      { data: { projects: { nodes: ["p"], pageInfo: { hasNextPage: false } } } },
    ]);
    await silently(() => runApi(ctx, { paginate: true, operation: "Beta" }, doc));
    expect(calls[0]!.query).toContain("projects");
    expect(calls[0]!.query).not.toContain("issues");
  });
});
