import { describe, it, expect } from "bun:test";
import {
  toRow,
  createMilestone,
  updateMilestone,
  getMilestoneDetail,
} from "../../src/services/milestone.js";
import { CliError } from "../../src/lib/errors.js";
import { connection } from "./_fakes.js";

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
        return { success: true, projectMilestone: Promise.resolve({ id: "new-m", name: input.name }) };
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
      createProjectMilestone: async () => ({ success: true, projectMilestone: Promise.resolve(null) }),
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
   * A milestone whose issue connection holds `total` issues.
   *
   * The page size is whatever the service asks for, and the connection is the
   * faithful one from `_fakes` — `fetchNext()` appends in place and returns
   * `this`. The previous version of this stub returned a *fresh* object from
   * `fetchNext()`, which is what let the truncation bug (AUDIT #5) ship with a
   * passing test: the service's post-collection read of `pageInfo.hasNextPage`
   * landed on an object the collection loop had left behind.
   */
  function stub(total: number, seen?: { first?: number }) {
    const all = Array.from({ length: total }, (_, i) => ({
      identifier: `TES-${i + 1}`,
      title: `Issue ${i + 1}`,
      state: Promise.resolve({ name: "Todo" }),
    }));
    return {
      projectMilestone: async () => ({
        id: "m1",
        name: "M1",
        description: null,
        targetDate: null,
        progress: 0.5,
        status: "next",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        project: Promise.resolve({ name: "Auth" }),
        issues: async ({ first }: any) => {
          if (seen) seen.first = first;
          return connection(all, first);
        },
      }),
    } as any;
  }

  it("returns the milestone's issues with their state", async () => {
    const d = await getMilestoneDetail(stub(2), UUID, 50);
    expect(d.issues).toEqual([
      { identifier: "TES-1", title: "Issue 1", state: "Todo" },
      { identifier: "TES-2", title: "Issue 2", state: "Todo" },
    ]);
    expect(d.issuesTruncated).toBe(false);
  });

  // A partial list must announce itself rather than looking complete.
  it("flags truncation when the cap hides issues", async () => {
    const d = await getMilestoneDetail(stub(10), UUID, 3);
    expect(d.issues).toHaveLength(3);
    expect(d.issuesTruncated).toBe(true);
  });

  // AUDIT #5, exactly as reproduced: 180 issues at --limit 150. The limit is
  // over one page, so collection has to follow `fetchNext` — and it is the
  // multi-page path where reading the connection afterwards lies.
  it("flags truncation when the hidden issues are past the first page", async () => {
    const d = await getMilestoneDetail(stub(180), UUID, 150);
    expect(d.issues).toHaveLength(150);
    expect(d.issuesTruncated).toBe(true);
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
    const seen: { first?: number } = {};
    await getMilestoneDetail(stub(10, seen), UUID, 3);
    expect(seen.first).toBe(4);
  });
});
