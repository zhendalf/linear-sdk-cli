import { describe, it, expect } from "bun:test";
import {
  toRow,
  createMilestone,
  updateMilestone,
  getMilestoneDetail,
  resolveMilestoneRef,
} from "../../src/services/milestone.js";
import { formatMilestoneProgress } from "../../src/commands/milestone.js";
import { CliError } from "../../src/lib/errors.js";
import { connection, rawPage } from "./_fakes.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

describe("toRow", () => {
  it("projects a milestone node to a row with sane defaults", () => {
    expect(
      toRow({ id: "m1", name: "Beta", targetDate: "2026-01-01", progress: 0.5, status: "next" }),
    ).toEqual({
      id: "m1",
      name: "Beta",
      targetDate: "2026-01-01",
      progress: 0.5,
      status: "next",
      description: null,
    });
  });

  it("nulls a missing target date and defaults progress to 0", () => {
    const row = toRow({ id: "m2", name: "Alpha" });
    expect(row.targetDate).toBeNull();
    expect(row.progress).toBe(0);
    expect(row.status).toBe("");
  });
});

describe("createMilestone", () => {
  it("builds the create input with projectId, name, description and targetDate", async () => {
    let captured: any;
    const client = {
      // resolveProjectId passes a uuid straight through (no SDK call).
      createProjectMilestone: async (input: any) => {
        captured = input;
        return {
          success: true,
          projectMilestone: Promise.resolve({ id: "new-m", name: input.name }),
        };
      },
    } as any;
    const created = await createMilestone(client, UUID, {
      name: "Phase 1",
      description: "do the thing",
      targetDate: "2026-03-01",
    });
    expect(captured).toEqual({
      projectId: UUID,
      name: "Phase 1",
      description: "do the thing",
      targetDate: "2026-03-01",
    });
    expect(created.id).toBe("new-m");
  });

  it("omits optional fields when not provided", async () => {
    let captured: any;
    const client = {
      createProjectMilestone: async (input: any) => {
        captured = input;
        return { success: true, projectMilestone: Promise.resolve({ id: "m", name: input.name }) };
      },
    } as any;
    await createMilestone(client, UUID, { name: "Bare" });
    expect(captured).toEqual({ projectId: UUID, name: "Bare" });
  });

  it("fails when the payload carries no milestone", async () => {
    const client = {
      createProjectMilestone: async () => ({
        success: true,
        projectMilestone: Promise.resolve(null),
      }),
    } as any;
    await expect(createMilestone(client, UUID, { name: "X" })).rejects.toMatchObject({
      code: "api",
    });
  });
});

describe("updateMilestone", () => {
  it("builds an update input from provided fields only", async () => {
    let captured: any;
    const client = {
      projectMilestone: async (id: string) => ({ id }),
      updateProjectMilestone: async (_id: string, input: any) => {
        captured = input;
        return { success: true, projectMilestone: Promise.resolve({ id: _id, name: input.name }) };
      },
    } as any;
    await updateMilestone(client, "m1", { name: "Renamed", targetDate: "2026-04-01" });
    expect(captured).toEqual({ name: "Renamed", targetDate: "2026-04-01" });
  });

  it("throws a usage error when there is nothing to update", async () => {
    const client = {
      projectMilestone: async (id: string) => ({ id }),
    } as any;
    await expect(updateMilestone(client, "m1", {})).rejects.toBeInstanceOf(CliError);
    await expect(updateMilestone(client, "m1", {})).rejects.toMatchObject({ code: "usage" });
  });
});

describe("getMilestoneDetail (issues + truncation)", () => {
  /**
   * A milestone whose issue connection holds `total` issues, served through
   * the tailored `CliMilestoneDetail` query — one `rawRequest` per page, with
   * the milestone fields riding along on every page and the issues cut at the
   * cursor. Every call is recorded (query text + variables) so the tests can
   * assert what went over the wire, not just what came back.
   */
  function stub(total: number, calls: Array<{ query: string; vars: any }> = []) {
    const all = Array.from({ length: total }, (_, i) => ({
      id: `issue-${i + 1}`,
      identifier: `TES-${i + 1}`,
      title: `Issue ${i + 1}`,
      state: { id: "st-todo", name: "Todo", type: "unstarted" },
    }));
    return {
      client: {
        rawRequest: async (query: string, vars: any) => {
          calls.push({ query, vars });
          return {
            data: {
              projectMilestone: {
                id: "m1",
                name: "M1",
                description: null,
                targetDate: null,
                progress: 0.5,
                status: "next",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
                project: { id: "p1", name: "Auth" },
                issues: rawPage(all, vars),
              },
            },
          };
        },
      },
    } as any;
  }

  it("returns the milestone's issues with their state — as objects, with ids", async () => {
    const d = await getMilestoneDetail(stub(2), UUID, 50);
    expect(d.issues).toEqual([
      {
        id: "issue-1",
        identifier: "TES-1",
        title: "Issue 1",
        state: { id: "st-todo", name: "Todo", type: "unstarted" },
      },
      {
        id: "issue-2",
        identifier: "TES-2",
        title: "Issue 2",
        state: { id: "st-todo", name: "Todo", type: "unstarted" },
      },
    ]);
    expect(d.project).toEqual({ id: "p1", name: "Auth" });
    expect(d.issuesTruncated).toBe(false);
  });

  // TES-622: the SDK-model version awaited `issue.state` once per issue, so a
  // 13-issue milestone cost 16 requests and `-n 50` on a full one ~53. Every
  // relation is selected in the query now, so a page of issues is one request.
  it("is ONE request for a milestone whose issues fit in a page, whatever their number", async () => {
    const calls: Array<{ query: string; vars: any }> = [];
    await getMilestoneDetail(stub(40, calls), UUID, 50);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toContain("projectMilestone(id: $id)");
    expect(calls[0]!.query).toContain("state { id name type }");
    expect(calls[0]!.query).toContain("project { id name }");
    expect(calls[0]!.vars).toEqual({ id: UUID, first: 51, after: undefined });
  });

  // A partial list must announce itself rather than looking complete.
  it("flags truncation when the cap hides issues", async () => {
    const d = await getMilestoneDetail(stub(10), UUID, 3);
    expect(d.issues).toHaveLength(3);
    expect(d.issuesTruncated).toBe(true);
  });

  // Regression case: 180 issues at --limit 150. The limit is over one page, so
  // collection has to follow the cursor — and it is the
  // multi-page path where reading a connection afterwards used to lie.
  it("flags truncation when the hidden issues are past the first page", async () => {
    const calls: Array<{ query: string; vars: any }> = [];
    const d = await getMilestoneDetail(stub(180, calls), UUID, 150);
    expect(d.issues).toHaveLength(150);
    expect(d.issuesTruncated).toBe(true);
    // The 151-node sentinel fits in Linear's 250-node page maximum.
    expect(calls.map((c) => c.vars.after)).toEqual([undefined]);
  });

  // Exactly `limit` issues is not truncation: the sentinel item is what
  // distinguishes "the last one fit" from "there is one more".
  it("does not claim truncation when the issues land exactly on the limit", async () => {
    const d = await getMilestoneDetail(stub(150), UUID, 150);
    expect(d.issues).toHaveLength(150);
    expect(d.issuesTruncated).toBe(false);
  });

  it("never truncates under --all", async () => {
    const d = await getMilestoneDetail(stub(230), UUID, Infinity);
    expect(d.issues).toHaveLength(230);
    expect(d.issuesTruncated).toBe(false);
  });

  // The spare slot is asked for up front, so detecting truncation costs no
  // extra round-trip for a limit that fits in one page.
  it("asks for one more than the limit so the sentinel is free", async () => {
    const calls: Array<{ query: string; vars: any }> = [];
    await getMilestoneDetail(stub(10, calls), UUID, 3);
    expect(calls[0]!.vars.first).toBe(4);
    expect(calls).toHaveLength(1);
  });

  it("a milestone the API does not return is not_found", async () => {
    const client = {
      client: { rawRequest: async () => ({ data: { projectMilestone: null } }) },
    } as any;
    await expect(getMilestoneDetail(client, UUID, 50)).rejects.toMatchObject({ code: "not_found" });
  });
});

/**
 * TES-634: `milestone view|update|delete` sent whatever they were given to
 * `projectMilestone(id:)`, so a name got the API's "Could not find referenced
 * ProjectMilestone" with no hint that only ids were tried, though the by-name
 * resolver existed for `issue create --milestone`. Names are unique only within
 * a project, so a name needs `--project` — the same rule as `issue update`.
 */
describe("resolveMilestoneRef", () => {
  function client(seen: string[] = []) {
    return {
      projects: async ({ filter }: any) => {
        seen.push(`projects:${filter.name.eqIgnoreCase}`);
        return connection([{ id: "proj-1", name: "Auth" }]);
      },
      project: async (id: string) => {
        seen.push(`project:${id}`);
        return {
          projectMilestones: async () =>
            connection([
              { id: "ms-beta", name: "Beta" },
              { id: "ms-ga", name: "GA" },
            ]),
        };
      },
    } as any;
  }

  it("passes a UUID straight through, touching nothing", async () => {
    const seen: string[] = [];
    expect(await resolveMilestoneRef(client(seen), UUID, undefined)).toBe(UUID);
    expect(await resolveMilestoneRef(client(seen), UUID, "Auth")).toBe(UUID);
    expect(seen).toEqual([]);
  });

  it("resolves a name inside --project, case-insensitively", async () => {
    const seen: string[] = [];
    expect(await resolveMilestoneRef(client(seen), "beta", "auth")).toBe("ms-beta");
    expect(seen).toEqual(["projects:auth", "project:proj-1"]);
  });

  it("a name without --project is a usage error that says what to pass", async () => {
    const seen: string[] = [];
    await expect(resolveMilestoneRef(client(seen), "Beta", undefined)).rejects.toMatchObject({
      code: "usage",
      message:
        "'Beta' is not a milestone id; pass --project <name|id> to look a milestone up by name.",
    });
    expect(seen).toEqual([]);
  });

  it("an unknown name in the project is not_found, listing the project's milestones", async () => {
    await expect(resolveMilestoneRef(client(), "Nope", "Auth")).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("Available: Beta, GA"),
    });
  });
});

/**
 * TES-648: `ProjectMilestone.progress` is already a percentage (38.46 for 38%,
 * verified live) — unlike `Project.progress`, a fraction. Multiplying by 100
 * printed `3846%` in `milestone list` and `view`.
 */
describe("formatMilestoneProgress", () => {
  it("treats the value as a percentage", () => {
    expect(formatMilestoneProgress(38.46)).toBe("38%");
    expect(formatMilestoneProgress(0)).toBe("0%");
    expect(formatMilestoneProgress(100)).toBe("100%");
  });
});
