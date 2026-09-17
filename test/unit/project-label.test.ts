import { describe, expect, it } from "bun:test";
import {
  createProjectLabel,
  deleteProjectLabel,
  getProjectLabel,
  listProjectLabels,
  restoreProjectLabel,
  retireProjectLabel,
  updateProjectLabel,
} from "../../src/services/project-label.js";

const ID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    name: "Risky",
    color: "#5E6AD2",
    description: "desc",
    isGroup: false,
    parent: null,
    retiredAt: null,
    children: { nodes: [] },
    ...overrides,
  };
}

function rawClient(nodes = [node()]) {
  const calls: Array<{ query: string; variables: any }> = [];
  const client = {
    client: {
      rawRequest: async (query: string, variables: any) => {
        calls.push({ query, variables });
        if (query.includes("CliProjectLabel(")) {
          const match = nodes.find((item: any) => item.id === variables.id);
          return { data: { projectLabel: match ?? null } };
        }
        const name = variables.filter?.name?.eqIgnoreCase;
        const matches = name
          ? nodes.filter(
              (item: any) =>
                item.name.toLowerCase() === name.toLowerCase() &&
                (variables.filter?.isGroup?.eq === undefined ||
                  item.isGroup === variables.filter.isGroup.eq),
            )
          : nodes;
        return {
          data: { projectLabels: { nodes: matches, pageInfo: { hasNextPage: false } } },
        };
      },
    },
  } as any;
  return { client, calls };
}

describe("project label reads", () => {
  it("lists the distinct project-label resource and forwards retired visibility", async () => {
    const { client, calls } = rawClient();
    const result = await listProjectLabels(client, 50, true);
    expect(result[0]).toEqual({
      id: ID,
      name: "Risky",
      color: "#5E6AD2",
      description: "desc",
      isGroup: false,
      parent: null,
      retiredAt: null,
    });
    expect(calls[0]!.variables.includeArchived).toBe(true);
    expect(calls[0]!.query).toContain("projectLabels");
    expect(calls[0]!.query).not.toContain("issueLabels");
  });

  it("views by exact name and includes children", async () => {
    const child = { id: OTHER, name: "High", color: "#ff0000", retiredAt: null };
    const { client } = rawClient([node({ isGroup: true, children: { nodes: [child] } })]);
    const result = await getProjectLabel(client, "Risky");
    expect(result.children).toEqual([child]);
  });

  it("reports duplicate exact names as ambiguous", async () => {
    const { client } = rawClient([node(), node({ id: OTHER })]);
    await expect(getProjectLabel(client, "Risky")).rejects.toMatchObject({ code: "ambiguous" });
  });
});

describe("project label mutations", () => {
  it("creates a child label under a validated group", async () => {
    const group = node({ id: OTHER, name: "Risk", isGroup: true });
    const { client } = rawClient([group]);
    let input: any;
    client.createProjectLabel = async (value: any) => {
      input = value;
      return { success: true, projectLabel: Promise.resolve(node({ name: "High" })) };
    };
    await createProjectLabel(client, { name: " High ", color: "#ff0000", parent: "Risk" });
    expect(input).toEqual({ name: "High", color: "#ff0000", parentId: OTHER });
  });

  it("resolves --parent among groups when an ordinary label has the same name", async () => {
    const group = node({ id: OTHER, name: "Risk", isGroup: true });
    const ordinary = node({ name: "Risk", isGroup: false });
    const { client } = rawClient([ordinary, group]);
    let input: any;
    client.createProjectLabel = async (value: any) => {
      input = value;
      return { success: true, projectLabel: Promise.resolve(node({ name: "High" })) };
    };
    await createProjectLabel(client, { name: "High", parent: "Risk" });
    expect(input.parentId).toBe(OTHER);
  });

  it("resolves --parent to the active group when a retired group has the same name", async () => {
    const active = node({ id: OTHER, name: "Risk", isGroup: true });
    const retired = node({ name: "Risk", isGroup: true, retiredAt: "2026-01-01T00:00:00Z" });
    const { client } = rawClient([retired, active]);
    let input: any;
    client.createProjectLabel = async (value: any) => {
      input = value;
      return { success: true, projectLabel: Promise.resolve(node({ name: "High" })) };
    };
    await createProjectLabel(client, { name: "High", parent: "Risk" });
    expect(input.parentId).toBe(OTHER);
  });

  it("rejects invalid color and group nesting before mutation", async () => {
    const { client } = rawClient();
    await expect(createProjectLabel(client, { name: "x", color: "red" })).rejects.toMatchObject({
      code: "usage",
    });
    await expect(
      createProjectLabel(client, { name: "x", group: true, parent: "Risky" }),
    ).rejects.toMatchObject({ code: "usage" });
  });

  it("updates and can clear group membership", async () => {
    const { client } = rawClient();
    let update: any;
    client.updateProjectLabel = async (id: string, value: any) => {
      update = { id, value };
      return { success: true, projectLabel: Promise.resolve(node({ name: "Safer" })) };
    };
    await updateProjectLabel(client, ID, { name: "Safer", clearParent: true });
    expect(update).toEqual({ id: ID, value: { name: "Safer", parentId: null } });
  });

  it("retire, restore, and delete use the public lifecycle mutations", async () => {
    const active = rawClient();
    active.client.projectLabelRetire = async () => ({
      success: true,
      projectLabel: Promise.resolve(node()),
    });
    expect((await retireProjectLabel(active.client, ID)).id).toBe(ID);

    const retired = rawClient([node({ retiredAt: "2026-01-01T00:00:00.000Z" })]);
    retired.client.projectLabelRestore = async () => ({
      success: true,
      projectLabel: Promise.resolve(node()),
    });
    expect((await restoreProjectLabel(retired.client, ID)).id).toBe(ID);

    let deleted: string | undefined;
    active.client.deleteProjectLabel = async (id: string) => {
      deleted = id;
      return { success: true };
    };
    expect((await deleteProjectLabel(active.client, ID)).name).toBe("Risky");
    expect(deleted).toBe(ID);
  });

  it("surfaces unsuccessful API mutation payloads", async () => {
    const { client } = rawClient();
    client.updateProjectLabel = async () => ({ success: false, projectLabel: null });
    await expect(updateProjectLabel(client, ID, { name: "Nope" })).rejects.toMatchObject({
      code: "api",
    });
  });
});
