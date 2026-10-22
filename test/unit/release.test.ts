import { describe, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { buildSchema, getVariableValues, Kind, parse, validate } from "graphql";
import * as svc from "../../src/services/release.js";
import {
  booleanValue,
  finiteNumber,
  issueReferences,
  parseReleaseLink,
} from "../../src/lib/release-input.js";
import { hasMoreResults } from "../../src/lib/pagination.js";
import { fakeRawRequest } from "./_omni.js";

const SHA = "a".repeat(40);
const PIPELINE = "11111111-1111-1111-1111-111111111111";
const RELEASE = "22222222-2222-2222-2222-222222222222";
const STAGE = "33333333-3333-3333-3333-333333333333";
const schema = buildSchema(
  readFileSync(new URL("../fixtures/release-schema.graphql", import.meta.url), "utf8"),
);

function pipeline(type = "scheduled") {
  return { id: PIPELINE, name: "Production", type };
}
function release(overrides: Record<string, unknown> = {}) {
  return {
    id: RELEASE,
    name: "1.2",
    version: "1.2",
    commitSha: SHA,
    pipeline: pipeline(),
    stage: { id: STAGE, name: "Verify", type: "started", frozen: true },
    ...overrides,
  };
}

/** Every document and variable set is checked against a read-only live-schema capture. */
function clientWith(handler?: (query: string, variables: Record<string, any>) => any) {
  const rawRequest = vi.fn(async (query: string, variables: Record<string, any>) => {
    const document = parse(query);
    expect(validate(schema, document).map((e) => e.message)).toEqual([]);
    const operation = document.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION)!;
    // Undefined fields are omitted by the SDK's JSON serializer.
    const wire = JSON.parse(JSON.stringify(variables));
    expect(
      getVariableValues(schema, operation.variableDefinitions ?? [], wire).errors,
    ).toBeUndefined();
    if (handler) return handler(query, variables);
    const result = await fakeRawRequest(query);
    if (query.includes("query CliReleasePipeline("))
      (result.data.releasePipeline as any).type = "scheduled";
    return result;
  });
  return { client: { rawRequest } } as any;
}
function inputOf(client: any, operation: string) {
  return client.client.rawRequest.mock.calls.find(([q]: [string]) => q.includes(operation))[1]
    .input;
}

describe("release schema compatibility", () => {
  it("validates every native read and mutation against the captured Linear schema", async () => {
    const client = clientWith();
    await svc.listReleases(client, 3, {
      pipeline: PIPELINE,
      version: "1.2",
      stageType: "started",
      includeArchived: true,
    });
    await svc.getRelease(client, RELEASE);
    await svc.listPipelines(client, 3, true);
    await svc.getPipeline(client, "production");
    await svc.listStages(client, PIPELINE, 3, true);
    await svc.getStage(client, STAGE);
    await svc.listNotes(client, 3, { pipeline: PIPELINE, release: RELEASE, includeArchived: true });
    await svc.getNote(client, RELEASE);
    await svc.listReleaseIssues(client, RELEASE, 3);
    await svc.listReleaseLinks(client, RELEASE, 3);
    await svc.createRelease(client, PIPELINE, {
      name: "1.2",
      version: "1.2",
      commitSha: SHA,
      stageId: STAGE,
      startDate: "2026-10-21",
      targetDate: "2026-10-22",
    });
    await svc.updateRelease(client, RELEASE, { description: null, commitSha: SHA });
    await svc.syncRelease(client, PIPELINE, "1.2", {
      commitSha: SHA,
      issueReferences: [{ identifier: "ENG-1", commitSha: SHA }],
      revertedIssueReferences: [{ identifier: "ENG-2", commitSha: SHA }],
      links: [{ label: "CI", url: "https://ci.example/run" }],
    });
    await svc.completeRelease(client, PIPELINE, "1.2", { commitSha: SHA, description: "Verified" });
    await svc.updateReleaseVersion(client, PIPELINE, "1.2", {
      stage: "Observe",
      description: null,
    });
    await svc.createPipeline(client, {
      name: "p",
      type: "scheduled",
      isProduction: false,
      rolloverIssuesOnCompletion: false,
      autoGenerateReleaseNotesOnCompletion: true,
      includePathPatterns: [],
      teamIds: [],
    });
    await svc.updatePipeline(client, PIPELINE, { rolloverIssuesOnCompletion: false });
    await svc.createStage(client, PIPELINE, {
      name: "Observe",
      color: "#123456",
      type: "started",
      position: 2,
      frozen: true,
    });
    await svc.updateStage(client, STAGE, { name: "Observe", frozen: false, position: 0 });
    await svc.createNote(client, PIPELINE, {
      title: "Notes",
      content: "# Shipped\n\n- ENG-1",
      releaseIds: [RELEASE],
    });
    await svc.createNote(client, PIPELINE, {
      rangeFromReleaseId: RELEASE,
      rangeToReleaseId: RELEASE,
    });
    await svc.updateNote(client, RELEASE, { content: "Updated", releaseIds: [RELEASE] });
    await svc.addIssue(client, RELEASE, "ENG-1");
    await svc.removeIssue(client, RELEASE, "ENG-1");
    await svc.deleteNote(client, RELEASE);
  });
});

describe("release lists and references", () => {
  it("paginates with the pipeline filter intact and reports truncation", async () => {
    const client = clientWith((q, v) => {
      if (q.includes("CliReleasePipeline(")) return { data: { releasePipeline: pipeline() } };
      expect(v.filter).toEqual({
        pipeline: { id: { eq: PIPELINE } },
        version: { eq: "1.2" },
        stage: { type: { eq: "started" } },
      });
      expect(v.archived).toBe(true);
      return {
        data: {
          releases: {
            nodes: [release({ id: v.after ?? RELEASE })],
            pageInfo: { hasNextPage: true, endCursor: "page2" },
          },
        },
      };
    });
    const rows = await svc.listReleases(client, 2, {
      pipeline: "production",
      version: "1.2",
      stageType: "started",
      includeArchived: true,
    });
    expect(rows.map((r) => r.id)).toEqual([RELEASE, "page2"]);
    expect(hasMoreResults(rows)).toBe(true);
    expect(client.client.rawRequest.mock.calls[2][1].after).toBe("page2");
  });
  it("fetches all pages and handles empty pipelines", async () => {
    const client = clientWith((_q, v) => ({
      data: {
        releasePipelines: {
          nodes: v.after ? [] : [pipeline()],
          pageInfo: { hasNextPage: !v.after, endCursor: "next" },
        },
      },
    }));
    const rows = await svc.listPipelines(client, Infinity);
    expect(rows).toHaveLength(1);
    expect(hasMoreResults(rows)).toBe(false);
    expect(client.client.rawRequest).toHaveBeenCalledTimes(2);
    expect(client.client.rawRequest.mock.calls[0][1].first).toBe(250);
  });
  it("keeps slug lookup explicit instead of searching pipeline names", async () => {
    const client = clientWith((_q, v) => {
      expect(v.id).toBe("production");
      return { data: { releasePipeline: pipeline() } };
    });
    await svc.getPipeline(client, "production");
    expect(client.client.rawRequest).toHaveBeenCalledTimes(1);
  });
  it("does not guess missing single resources or silently accept absent data", async () => {
    for (const [fn, field] of [
      [svc.getRelease, "release"],
      [svc.getPipeline, "releasePipeline"],
      [svc.getStage, "releaseStage"],
      [svc.getNote, "releaseNote"],
    ] as const) {
      await expect(
        fn(
          clientWith(() => ({ data: { [field]: null } })),
          "missing",
        ),
      ).rejects.toMatchObject({ code: "not_found" });
    }
    await expect(
      svc.listPipelines(
        clientWith(() => ({})),
        1,
      ),
    ).rejects.toMatchObject({ code: "api" });
  });
  it("extracts Markdown from the backing note document, including null content", async () => {
    const client = clientWith(() => ({
      data: { releaseNote: { id: RELEASE, documentContent: { content: "# Notes\n\nBody" } } },
    }));
    expect(await svc.getNote(client, RELEASE)).toMatchObject({
      id: RELEASE,
      content: "# Notes\n\nBody",
    });
    expect(
      await svc.getNote(
        clientWith(() => ({ data: { releaseNote: { id: RELEASE, documentContent: null } } })),
        RELEASE,
      ),
    ).toMatchObject({ id: RELEASE, content: null });
  });
});

describe("release lifecycle and scope", () => {
  it("uses explicit versions on sync, update and completion; never sends latest fallback", async () => {
    const client = clientWith();
    await svc.syncRelease(client, "production", "release/1.2", { commitSha: SHA });
    await svc.updateReleaseVersion(client, "production", "release/1.2", { stage: "Verify" });
    await svc.completeRelease(client, "production", "release/1.2", {});
    for (const op of [
      "mutation ClireleaseSync",
      "mutation ClireleaseUpdateByPipeline",
      "mutation ClireleaseComplete",
    ]) {
      expect(inputOf(client, op)).toMatchObject({ pipelineId: PIPELINE, version: "release/1.2" });
    }
  });
  it("does not complete continuous pipelines a second time", async () => {
    const client = clientWith(() => ({ data: { releasePipeline: pipeline("continuous") } }));
    await expect(svc.completeRelease(client, PIPELINE, "1.2")).rejects.toMatchObject({
      code: "usage",
    });
    expect(client.client.rawRequest).toHaveBeenCalledTimes(1);
  });
  it("rejects blank versions and invalid exact SHAs/dates before any requests", async () => {
    const client = clientWith();
    await expect(svc.syncRelease(client, PIPELINE, " ", { commitSha: SHA })).rejects.toMatchObject({
      code: "usage",
    });
    await expect(svc.completeRelease(client, PIPELINE, "")).rejects.toMatchObject({
      code: "usage",
    });
    await expect(
      svc.createRelease(client, PIPELINE, { name: "n", commitSha: "HEAD" }),
    ).rejects.toMatchObject({ code: "usage" });
    await expect(
      svc.updateRelease(client, RELEASE, { targetDate: "2026-02-30" }),
    ).rejects.toMatchObject({ code: "usage" });
    expect(client.client.rawRequest).not.toHaveBeenCalled();
  });
  it("rejects a stage from another pipeline before writing", async () => {
    const client = clientWith((q) =>
      q.includes("CliReleaseStage")
        ? { data: { releaseStage: { pipeline: { id: "another" } } } }
        : { data: { release: release() } },
    );
    await expect(svc.updateRelease(client, RELEASE, { stageId: STAGE })).rejects.toMatchObject({
      code: "usage",
    });
    expect(
      client.client.rawRequest.mock.calls.every(([q]: [string]) => !q.startsWith("mutation")),
    ).toBe(true);
  });
  it("preserves false booleans, empty collections and stage position zero", async () => {
    const client = clientWith();
    await svc.updatePipeline(client, PIPELINE, {
      isProduction: false,
      rolloverIssuesOnCompletion: false,
      includePathPatterns: [],
      teamIds: [],
    });
    expect(inputOf(client, "mutation ClireleasePipelineUpdate")).toEqual({
      isProduction: false,
      rolloverIssuesOnCompletion: false,
      includePathPatterns: [],
      teamIds: [],
    });
    await svc.updateStage(client, STAGE, { position: 0, frozen: false });
    expect(inputOf(client, "mutation ClireleaseStageUpdate")).toEqual({
      position: 0,
      frozen: false,
    });
  });
  it("validates stage type/frozen constraints without guessing a different stage", async () => {
    const client = clientWith(() => ({ data: { releaseStage: { id: STAGE, type: "completed" } } }));
    await expect(svc.updateStage(client, STAGE, { frozen: true })).rejects.toMatchObject({
      code: "usage",
    });
    await expect(
      svc.createStage(client, PIPELINE, {
        name: "Done",
        type: "completed",
        color: "#123456",
        position: 1,
        frozen: true,
      }),
    ).rejects.toMatchObject({ code: "usage" });
    expect(client.client.rawRequest).toHaveBeenCalledTimes(1);
  });
  it("rejects empty updates for every resource", async () => {
    const client = clientWith();
    for (const fn of [svc.updateRelease, svc.updatePipeline, svc.updateStage, svc.updateNote]) {
      await expect(fn(client, RELEASE, {})).rejects.toMatchObject({ code: "usage" });
    }
    await expect(svc.updateReleaseVersion(client, PIPELINE, "1.2", {})).rejects.toMatchObject({
      code: "usage",
    });
    expect(client.client.rawRequest).not.toHaveBeenCalled();
  });
});

describe("release notes and membership", () => {
  it("rejects missing or conflicting note scopes before writing", async () => {
    const client = clientWith();
    for (const input of [
      {},
      { releaseIds: [] },
      { rangeFromReleaseId: RELEASE },
      { releaseIds: [RELEASE], rangeFromReleaseId: RELEASE, rangeToReleaseId: RELEASE },
    ]) {
      await expect(svc.createNote(client, PIPELINE, input)).rejects.toMatchObject({
        code: "usage",
      });
    }
    expect(client.client.rawRequest).not.toHaveBeenCalled();
  });
  it("refuses releases in another pipeline and resolves/deduplicates explicit scope", async () => {
    const client = clientWith();
    await svc.createNote(client, PIPELINE, { releaseIds: [RELEASE, RELEASE] });
    expect(inputOf(client, "mutation ClireleaseNoteCreate").releaseIds).toEqual([PIPELINE]); // omni canonical UUID
    const wrong = clientWith((q) =>
      q.includes("CliReleasePipeline(")
        ? { data: { releasePipeline: pipeline() } }
        : { data: { release: release({ pipeline: { id: "other" } }) } },
    );
    await expect(svc.createNote(wrong, PIPELINE, { releaseIds: [RELEASE] })).rejects.toMatchObject({
      code: "usage",
    });
    expect(
      wrong.client.rawRequest.mock.calls.every(([q]: [string]) => !q.startsWith("mutation")),
    ).toBe(true);
  });
  it("adds/removes only the requested issue and exact canonical release ID", async () => {
    const client = clientWith(async (q) =>
      q.includes("query CliRelease(") ? { data: { release: release() } } : fakeRawRequest(q),
    );
    await svc.addIssue(client, "release-slug", "ENG-42");
    expect(inputOf(client, "CliIssueToReleaseCreate")).toEqual({
      releaseId: RELEASE,
      issueId: "ENG-42",
    });
    expect(await svc.removeIssue(client, "release-slug", "ENG-42")).toEqual({
      releaseId: RELEASE,
      issue: "ENG-42",
      removed: true,
    });
    expect(client.client.rawRequest.mock.calls.at(-1)[1]).toEqual({
      releaseId: RELEASE,
      issueId: "ENG-42",
    });
  });
  it("never reports success when a mutation returns false or omits its entity", async () => {
    for (const payload of [{ success: false }, { success: true, releasePipeline: null }]) {
      await expect(
        svc.createPipeline(
          clientWith(() => ({ data: { releasePipelineCreate: payload } })),
          { name: "p", type: "scheduled" },
        ),
      ).rejects.toMatchObject({ code: "api" });
    }
    const client = clientWith((q) =>
      q.includes("query CliRelease(")
        ? { data: { release: release() } }
        : { data: { issueToReleaseDeleteByIssueAndRelease: { success: false } } },
    );
    await expect(svc.removeIssue(client, RELEASE, "ENG-1")).rejects.toMatchObject({ code: "api" });
  });
  it("retains feature and permission error codes without probing mutations", async () => {
    for (const type of ["FeatureNotAccessible", "Forbidden"]) {
      const client = clientWith(() => {
        throw Object.assign(new Error("Unavailable"), { type });
      });
      await expect(svc.listPipelines(client, 1)).rejects.toMatchObject({
        code: type === "Forbidden" ? "forbidden" : "feature_not_accessible",
      });
      expect(client.client.rawRequest).toHaveBeenCalledTimes(1);
    }
  });
});

describe("release input parsing", () => {
  it("preserves URL equals signs and labeled links", () => {
    expect(parseReleaseLink("https://example.com/?id=1")).toEqual({
      url: "https://example.com/?id=1",
    });
    expect(parseReleaseLink("CI=https://example.com/?id=1")).toEqual({
      label: "CI",
      url: "https://example.com/?id=1",
    });
    for (const v of [
      "data:text/plain,x",
      "javascript:alert(1)",
      "CI=nope",
      "https://user:password@example.com",
    ])
      expect(() => parseReleaseLink(v)).toThrow();
  });
  it("parses explicit attribution without inferring Git history", () => {
    expect(issueReferences(["eng-1", `ENG-2=${"b".repeat(40)}`], SHA)).toEqual([
      { identifier: "ENG-1", commitSha: SHA },
      { identifier: "ENG-2", commitSha: "b".repeat(40) },
    ]);
    expect(() => issueReferences(["ENG-1=HEAD"], SHA)).toThrow();
    expect(() => issueReferences(["nonsense"], SHA)).toThrow();
  });
  it("rejects loose boolean and numeric coercion", () => {
    expect(booleanValue("false")).toBe(false);
    expect(finiteNumber("0")).toBe(0);
    for (const v of ["", "yes", "0"]) expect(() => booleanValue(v)).toThrow();
    for (const v of ["", "NaN", "Infinity", "oops"]) expect(() => finiteNumber(v)).toThrow();
  });
});
