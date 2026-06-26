import { describe, it, expect } from "bun:test";
import {
  formatProgress,
  dateStr,
  createCycle,
  updateCycle,
  getCycleDetail,
} from "../../src/services/cycle.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

/** A client whose team lookups resolve TES, and which records mutation inputs. */
function makeClient(record: { create?: any; update?: any } = {}) {
  return {
    teams: async () => ({ nodes: [{ id: "team-1", key: "TES", name: "Test" }] }),
    team: async (id: string) => ({
      id,
      key: "TES",
      name: "Test",
      cycles: async () => ({ nodes: [{ id: "cyc-3", number: 3 }] }),
    }),
    cycle: async (id: string) => ({
      id,
      number: 5,
      name: "Sprint",
      description: null,
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
      endsAt: new Date("2026-07-14T00:00:00.000Z"),
      completedAt: null,
      progress: 0.5,
      team: Promise.resolve({ key: "TES" }),
    }),
    createCycle: async (input: any) => {
      record.create = input;
      return { cycle: Promise.resolve({ id: "new-cyc", number: 9 }) };
    },
    updateCycle: async (id: string, input: any) => {
      record.update = { id, input };
      return { cycle: Promise.resolve({ id, number: 5 }) };
    },
  } as any;
}

describe("formatProgress", () => {
  it("renders 0..1 as a rounded percentage", () => {
    expect(formatProgress(0)).toBe("0%");
    expect(formatProgress(0.5)).toBe("50%");
    expect(formatProgress(0.426)).toBe("43%");
    expect(formatProgress(1)).toBe("100%");
  });
  it("treats missing progress as 0%", () => {
    expect(formatProgress(undefined as any)).toBe("0%");
  });
});

describe("dateStr", () => {
  it("formats a Date as ISO", () => {
    expect(dateStr(new Date("2026-07-01T00:00:00.000Z"))).toBe("2026-07-01T00:00:00.000Z");
  });
  it("passes strings through", () => {
    expect(dateStr("2026-07-01")).toBe("2026-07-01");
  });
});

describe("createCycle", () => {
  it("builds a CycleCreateInput with teamId, dates, and name", async () => {
    const record: any = {};
    const client = makeClient(record);
    const created = await createCycle(
      client,
      { team: "tes", name: "Sprint A", startsAt: "2026-07-01", endsAt: "2026-07-14" },
      undefined,
    );
    expect(record.create).toEqual({
      teamId: "team-1",
      startsAt: "2026-07-01",
      endsAt: "2026-07-14",
      name: "Sprint A",
    });
    expect(created.number).toBe(9);
  });

  it("omits name when not provided and uses the default team", async () => {
    const record: any = {};
    const client = makeClient(record);
    await createCycle(client, { startsAt: "2026-07-01", endsAt: "2026-07-14" }, "TES");
    expect(record.create).toEqual({
      teamId: "team-1",
      startsAt: "2026-07-01",
      endsAt: "2026-07-14",
    });
  });
});

describe("updateCycle", () => {
  it("passes a uuid id straight through and builds a partial input", async () => {
    const record: any = {};
    const client = makeClient(record);
    await updateCycle(client, UUID, { name: "Renamed" }, undefined, undefined);
    expect(record.update).toEqual({ id: UUID, input: { name: "Renamed" } });
  });

  it("resolves a cycle number against the team before updating", async () => {
    const record: any = {};
    const client = makeClient(record);
    await updateCycle(client, "3", { startsAt: "2026-08-01" }, "TES", undefined);
    expect(record.update.id).toBe("cyc-3");
    expect(record.update.input).toEqual({ startsAt: "2026-08-01" });
  });

  it("throws a usage error when nothing is passed", async () => {
    const client = makeClient();
    await expect(updateCycle(client, UUID, {}, undefined, undefined)).rejects.toMatchObject({
      code: "usage",
    });
  });

  it("throws a usage error resolving a number without a team", async () => {
    const client = makeClient();
    await expect(
      updateCycle(client, "3", { name: "x" }, undefined, undefined),
    ).rejects.toMatchObject({ code: "usage" });
  });
});

describe("getCycleDetail", () => {
  it("resolves a uuid and shapes the detail object", async () => {
    const client = makeClient();
    const d = await getCycleDetail(client, UUID, undefined, undefined);
    expect(d).toMatchObject({
      id: UUID,
      number: 5,
      name: "Sprint",
      startsAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2026-07-14T00:00:00.000Z",
      progress: 0.5,
      team: "TES",
    });
  });
});
