import { describe, it, expect } from "bun:test";
import { buildFilter } from "../../src/services/project.js";

const client = {} as any;

describe("project buildFilter", () => {
  it("filters by accessible team key (uppercased)", async () => {
    expect(await buildFilter(client, { team: "tes" }, undefined)).toEqual({
      accessibleTeams: { some: { key: { eq: "TES" } } },
    });
  });

  it("uses the default team when none given", async () => {
    expect(await buildFilter(client, {}, "ENG")).toEqual({
      accessibleTeams: { some: { key: { eq: "ENG" } } },
    });
  });

  it("returns an empty filter when no team and no state", async () => {
    expect(await buildFilter(client, {}, undefined)).toEqual({});
  });

  it("filters by project state with eq", async () => {
    const f = await buildFilter(client, { state: "started" }, undefined);
    expect(f.state).toEqual({ eq: "started" });
  });

  it("combines team and state filters", async () => {
    const f = await buildFilter(client, { team: "tes", state: "completed" }, undefined);
    expect(f).toEqual({
      accessibleTeams: { some: { key: { eq: "TES" } } },
      state: { eq: "completed" },
    });
  });

  it("prefers an explicit team over the default", async () => {
    const f = await buildFilter(client, { team: "abc" }, "ENG");
    expect(f.accessibleTeams).toEqual({ some: { key: { eq: "ABC" } } });
  });
});
