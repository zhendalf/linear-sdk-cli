import { describe, expect, it } from "bun:test";
import { IssueLabel } from "@linear/sdk";
import { resolveLabelIds } from "../../src/lib/resolve.js";
import { connection } from "./_fakes.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

function label(id: string, name: string, teamId?: string, isGroup = false) {
  return new IssueLabel(
    (() => {
      throw new Error("Unexpected relationship request");
    }) as any,
    { id, name, isGroup, team: teamId ? { id: teamId } : null } as any,
  );
}

function clientWith(labels: IssueLabel[], per = labels.length) {
  return { issueLabels: async () => connection(labels, per) } as any;
}

describe("resolveLabelIds", () => {
  it("starts independent lookups together and preserves input order and UUIDs", async () => {
    const pending = new Map<string, (value: any) => void>();
    const client = {
      issueLabels: ({ filter }: any) =>
        new Promise((resolve) => {
          pending.set(filter.name.eqIgnoreCase, resolve);
        }),
    } as any;
    const result = resolveLabelIds(client, ["Bug", UUID, "Feature"], "team");
    expect([...pending.keys()]).toEqual(["Bug", "Feature"]);
    pending.get("Feature")!(connection([label("feature", "Feature", "team")]));
    pending.get("Bug")!(connection([label("bug", "Bug", "team")]));
    expect(await result).toEqual(["bug", UUID, "feature"]);
  });

  it("shares an in-flight paginated lookup for duplicate names", async () => {
    let searches = 0;
    let release!: (value: any) => void;
    const page = connection([label("other", "Bug", "other"), label("bug", "Bug", "team")], 1);
    let nextPages = 0;
    const fetchNext = page.fetchNext.bind(page);
    page.fetchNext = async () => {
      nextPages++;
      return fetchNext();
    };
    const client = {
      issueLabels: () => {
        searches++;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    } as any;
    const result = resolveLabelIds(client, ["Bug", "Bug", "Bug"], "team");
    expect(searches).toBe(1);
    release(page);
    expect(await result).toEqual(["bug", "bug", "bug"]);
    expect(nextPages).toBe(1);
  });

  it("preserves case-sensitive preference for differently spelled inputs", async () => {
    const client = clientWith([label("upper", "Bug"), label("lower", "bug")]);
    expect(await resolveLabelIds(client, ["Bug", "bug", "Bug"])).toEqual([
      "upper",
      "lower",
      "upper",
    ]);
  });

  it("does not cache failures or stale results across calls", async () => {
    let searches = 0;
    let labels: IssueLabel[] = [];
    const client = {
      issueLabels: async () => {
        searches++;
        return connection(labels);
      },
    } as any;
    await expect(resolveLabelIds(client, ["Bug", "Bug"])).rejects.toMatchObject({
      code: "not_found",
    });
    labels = [label("new", "Bug")];
    expect(await resolveLabelIds(client, ["Bug", "Bug"])).toEqual(["new", "new"]);
    labels = [label("replacement", "Bug")];
    expect(await resolveLabelIds(client, ["Bug"])).toEqual(["replacement"]);
    expect(searches).toBe(3);
  });

  it("scopes SDK labels without fetching their team and follows later pages", async () => {
    const client = clientWith(
      [
        label("other", "Bug", "other"),
        label("group", "Bug", "team", true),
        label("wanted", "Bug", "team"),
      ],
      1,
    );
    expect(await resolveLabelIds(client, ["Bug"], "team")).toEqual(["wanted"]);
  });

  it("accepts workspace labels and prefers exact case", async () => {
    const client = clientWith([label("lower", "bug", "team"), label("exact", "Bug")]);
    expect(await resolveLabelIds(client, ["Bug"], "team")).toEqual(["exact"]);
  });

  it("rejects ambiguous labels within the team and workspace", async () => {
    const client = clientWith([label("team", "Bug", "team"), label("global", "Bug")]);
    await expect(resolveLabelIds(client, ["Bug"], "team")).rejects.toMatchObject({
      code: "ambiguous",
    });
  });

  it("does not fall back to another team's label", async () => {
    await expect(
      resolveLabelIds(clientWith([label("other", "Bug", "other")]), ["Bug"], "team"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects group-only and empty matches with or without a team", async () => {
    for (const teamId of [undefined, "team"]) {
      for (const labels of [[], [label("group", "Bug", undefined, true)]]) {
        await expect(resolveLabelIds(clientWith(labels), ["Bug"], teamId)).rejects.toMatchObject({
          code: "not_found",
        });
      }
    }
  });

  it("passes UUIDs and empty inputs through without lookups", async () => {
    expect(await resolveLabelIds({} as any, [UUID, UUID])).toEqual([UUID, UUID]);
    expect(await resolveLabelIds({} as any, [])).toEqual([]);
  });
});
