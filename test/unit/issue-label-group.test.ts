import { describe, expect, it } from "bun:test";
import {
  executeIssueLabelGroupUpdate,
  parseIssueLabelGroupAssignment,
  planIssueLabelGroupUpdate,
  prepareIssueLabelGroupUpdate,
  verifyIssueLabelGroups,
  type IssueLabelMetadata,
} from "../../src/services/issue.js";
import { connection, payload, rawPage } from "./_fakes.js";

const TEAM_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_TEAM_ID = "22222222-2222-2222-2222-222222222222";
const TEAM_GROUP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const QA_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const ENG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const TYPE_GROUP_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const BUG_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
const FEATURE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3";
const UNRELATED_ID = "cccccccc-cccc-cccc-cccc-ccccccccccc1";

const team = { id: TEAM_ID, key: "TES", name: "Test" };
const otherTeam = { id: OTHER_TEAM_ID, key: "OUT", name: "Other" };
const ref = (id: string, name: string) => ({ id, name });

function label(
  id: string,
  name: string,
  options: Partial<IssueLabelMetadata> = {},
): IssueLabelMetadata {
  return {
    id,
    name,
    isGroup: false,
    archivedAt: null,
    team,
    parent: null,
    inheritedFrom: null,
    ...options,
  };
}

const labels: IssueLabelMetadata[] = [
  label(TEAM_GROUP_ID, "Team", { isGroup: true, team: null }),
  label(QA_ID, "QA", { team: null, parent: ref(TEAM_GROUP_ID, "Team") }),
  label(ENG_ID, "Engineering", { team: null, parent: ref(TEAM_GROUP_ID, "Team") }),
  label(TYPE_GROUP_ID, "Issue Type", {
    isGroup: true,
    inheritedFrom: ref("dddddddd-dddd-dddd-dddd-dddddddddddd", "Issue Type"),
  }),
  label(BUG_ID, "Bug", {
    parent: ref(TYPE_GROUP_ID, "Issue Type"),
    inheritedFrom: ref("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", "Bug"),
  }),
  label(FEATURE_ID, "Feature", { parent: ref(TYPE_GROUP_ID, "Issue Type") }),
  label(UNRELATED_ID, "platform:web"),
];

function plan(assignments: string[], current = [ENG_ID, FEATURE_ID, UNRELATED_ID]) {
  return planIssueLabelGroupUpdate(
    {
      id: "issue-1",
      identifier: "TES-1",
      teamId: TEAM_ID,
      currentLabels: current.map((id) => {
        const found = labels.find((candidate) => candidate.id === id);
        return ref(id, found?.name ?? id);
      }),
    },
    labels,
    assignments,
  );
}

describe("issue label-group assignment parsing", () => {
  it("splits on only the first equals sign and trims separator whitespace", () => {
    expect(parseIssueLabelGroupAssignment("Issue Type = error=server")).toEqual({
      group: "Issue Type",
      label: "error=server",
    });
  });

  for (const malformed of ["Team", "=QA", "Team=", " = "]) {
    it(`rejects malformed assignment ${JSON.stringify(malformed)}`, () => {
      expect(() => parseIssueLabelGroupAssignment(malformed)).toThrow(/GROUP=LABEL/);
    });
  }
});

describe("issue label-group mutation planning", () => {
  it("replaces multiple groups in one relative mutation and preserves unrelated labels", () => {
    const result = plan(["Team=QA", "Issue Type=Bug"]);
    expect(result.input).toEqual({
      addedLabelIds: [QA_ID, BUG_ID],
      removedLabelIds: [ENG_ID, FEATURE_ID],
    });
    expect(result.changed).toBe(true);
    expect(result.currentLabelIds).toContain(UNRELATED_ID);
    expect(result.groups).toEqual([
      { group: ref(TEAM_GROUP_ID, "Team"), label: ref(QA_ID, "QA") },
      { group: ref(TYPE_GROUP_ID, "Issue Type"), label: ref(BUG_ID, "Bug") },
    ]);
  });

  it("normalizes identical duplicates, including name/id aliases", () => {
    const result = plan(["Team=QA", `${TEAM_GROUP_ID}=${QA_ID}`, "Team=QA"]);
    expect(result.groups).toHaveLength(1);
    expect(result.input.addedLabelIds).toEqual([QA_ID]);
  });

  it("rejects conflicting duplicates before a mutation", () => {
    expect(() => plan(["Team=QA", "Team=Engineering"])).toThrow(/assigned both/);
  });

  it("returns an explicit no-op when the requested member is already the sole member", async () => {
    const result = plan(["Team=QA"], [QA_ID, UNRELATED_ID]);
    expect(result).toMatchObject({ changed: false });
    expect(result.input).toEqual({ addedLabelIds: [], removedLabelIds: [] });
    let writes = 0;
    const sent = await executeIssueLabelGroupUpdate(
      { updateIssue: async () => (writes += 1) } as any,
      result,
    );
    expect(sent).toBe(false);
    expect(writes).toBe(0);
  });

  it("repairs multiple applied members and records the complete prior group state", () => {
    const result = plan(["Team=QA"], [QA_ID, ENG_ID, UNRELATED_ID]);
    expect(result.input).toEqual({ addedLabelIds: [], removedLabelIds: [ENG_ID] });
    expect(result.priorState).toEqual([
      {
        group: ref(TEAM_GROUP_ID, "Team"),
        labels: [ref(QA_ID, "QA"), ref(ENG_ID, "Engineering")],
      },
    ]);
  });

  it("accepts workspace and inherited team groups by exact UUID", () => {
    const result = plan([`${TEAM_GROUP_ID}=${QA_ID}`, `${TYPE_GROUP_ID}=${BUG_ID}`]);
    expect(result.groups.map((item) => item.group.id)).toEqual([TEAM_GROUP_ID, TYPE_GROUP_ID]);
  });

  it("uses exact case-sensitive names and stable not-found semantics", () => {
    try {
      plan(["team=QA"]);
      throw new Error("expected exact group-name lookup to fail");
    } catch (error: any) {
      expect(error).toMatchObject({ code: "not_found" });
    }
    try {
      plan(["Team=qa"]);
      throw new Error("expected exact member-name lookup to fail");
    } catch (error: any) {
      expect(error).toMatchObject({ code: "not_found" });
    }
  });

  it("sends one update with the exact planned input", async () => {
    const result = plan(["Team=QA", "Issue Type=Bug"]);
    const writes: Array<{ id: string; input: unknown }> = [];
    const client = {
      updateIssue: async (id: string, input: unknown) => {
        writes.push({ id, input });
        return payload("issue", { id, identifier: "TES-1" });
      },
    } as any;
    expect(await executeIssueLabelGroupUpdate(client, result)).toBe(true);
    expect(writes).toEqual([{ id: "issue-1", input: result.input }]);
  });

  it("rejects duplicate group/member names as ambiguous", () => {
    const duplicateGroup = label("ffffffff-ffff-ffff-ffff-fffffffffff1", "Team", {
      isGroup: true,
      team: null,
    });
    try {
      planIssueLabelGroupUpdate(
        { id: "i", identifier: "TES-1", teamId: TEAM_ID, currentLabels: [] },
        [...labels, duplicateGroup],
        ["Team=QA"],
      );
      throw new Error("expected duplicate groups to fail");
    } catch (error: any) {
      expect(error).toMatchObject({ code: "ambiguous" });
      expect(error.message).toContain("Multiple issue label groups");
    }

    const duplicateMember = label("ffffffff-ffff-ffff-ffff-fffffffffff2", "QA", {
      team: null,
      parent: ref(TEAM_GROUP_ID, "Team"),
    });
    try {
      planIssueLabelGroupUpdate(
        { id: "i", identifier: "TES-1", teamId: TEAM_ID, currentLabels: [] },
        [...labels, duplicateMember],
        ["Team=QA"],
      );
      throw new Error("expected duplicate members to fail");
    } catch (error: any) {
      expect(error).toMatchObject({ code: "ambiguous" });
      expect(error.message).toContain("Multiple direct members");
    }
  });

  it("rejects archived, out-of-scope, container, and wrong-group targets", () => {
    const archivedGroup = label("ffffffff-ffff-ffff-ffff-fffffffffff3", "Archived", {
      isGroup: true,
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
    const archivedMember = label("ffffffff-ffff-ffff-ffff-fffffffffff4", "Old", {
      archivedAt: "2026-01-01T00:00:00.000Z",
      parent: ref(TEAM_GROUP_ID, "Team"),
    });
    const outGroup = label("ffffffff-ffff-ffff-ffff-fffffffffff5", "Out", {
      isGroup: true,
      team: otherTeam,
    });
    const outMember = label("ffffffff-ffff-ffff-ffff-fffffffffff6", "Elsewhere", {
      team: otherTeam,
      parent: ref(TEAM_GROUP_ID, "Team"),
    });
    const all = [...labels, archivedGroup, archivedMember, outGroup, outMember];
    const build = (assignment: string) =>
      planIssueLabelGroupUpdate(
        { id: "i", identifier: "TES-1", teamId: TEAM_ID, currentLabels: [] },
        all,
        [assignment],
      );

    expect(() => build("Archived=QA")).toThrow(/archived/);
    expect(() => build("Team=Old")).toThrow(/archived/);
    expect(() => build("Out=QA")).toThrow(/not usable/);
    expect(() => build(`Team=${outMember.id}`)).toThrow(/not usable/);
    expect(() => build(`Team=${TYPE_GROUP_ID}`)).toThrow(/group container/);
    expect(() => build("Team=Bug")).toThrow(/belongs to 'Issue Type'/);
    try {
      build("Team=Old");
      throw new Error("expected archived label to fail");
    } catch (error: any) {
      expect(error).toMatchObject({ code: "validation" });
    }
  });

  it("fails verification when a sibling remains or the target is absent", () => {
    const result = plan(["Team=QA"]);
    expect(() => verifyIssueLabelGroups(result, [QA_ID, ENG_ID])).toThrow(/read-back/);
    expect(() => verifyIssueLabelGroups(result, [UNRELATED_ID])).toThrow(/read-back/);
    expect(() => verifyIssueLabelGroups(result, [QA_ID, UNRELATED_ID])).not.toThrow();
  });
});

describe("issue label-group API preparation", () => {
  it("scans current labels and all visible metadata including archived/inherited fields", async () => {
    const queries: string[] = [];
    const issue = {
      id: "issue-1",
      identifier: "TES-1",
      team: Promise.resolve(team),
      labels: async () =>
        connection([ref(ENG_ID, "Engineering"), ref(UNRELATED_ID, "platform:web")]),
    };
    const client = {
      issues: async () => connection([issue]),
      client: {
        rawRequest: async (query: string, variables: { first: number; after?: string }) => {
          queries.push(query);
          return { data: { issueLabels: rawPage(labels, variables) } };
        },
      },
    } as any;
    const result = await prepareIssueLabelGroupUpdate(client, "TES-1", ["Team=QA"]);
    expect(result.input).toEqual({ addedLabelIds: [QA_ID], removedLabelIds: [ENG_ID] });
    expect(queries[0]).toContain("includeArchived: true");
    expect(queries[0]).toContain("inheritedFrom { id name }");
  });

  it("rejects malformed syntax before any API read", async () => {
    let reads = 0;
    const client = {
      issues: async () => {
        reads += 1;
        return connection([]);
      },
    } as any;
    await expect(prepareIssueLabelGroupUpdate(client, "TES-1", ["Team"])).rejects.toMatchObject({
      code: "usage",
    });
    expect(reads).toBe(0);
  });
});
