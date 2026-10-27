import { describe, expect, it } from "bun:test";
import { resolveProjectId } from "../../src/lib/resolve.js";
import { CliError } from "../../src/lib/errors.js";
import { buildFilter } from "../../src/services/issue.js";
import { resolveTarget } from "../../src/services/document.js";
import { buildFavoriteInput } from "../../src/services/favorite.js";
import { updateProject } from "../../src/services/project.js";
import { listMilestones } from "../../src/services/milestone.js";
import { connection } from "./_fakes.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

function canonicalClient() {
  const references: string[] = [];
  return {
    references,
    client: {
      projects: async () => connection([]),
      project: async (reference: string) => {
        references.push(reference);
        return { id: UUID, projectMilestones: async () => connection([]) };
      },
    } as any,
  };
}

describe("project references", () => {
  it("retains UUID pass-through and exact name matching without canonical requests", async () => {
    expect(await resolveProjectId({} as any, UUID)).toBe(UUID);
    const client = {
      projects: async (args: any) => {
        expect(args.filter).toEqual({ name: { eqIgnoreCase: "auth" } });
        return connection([{ id: UUID }]);
      },
    } as any;
    expect(await resolveProjectId(client, "auth")).toBe(UUID);
  });

  it("retains ambiguity errors instead of guessing a canonical match", async () => {
    const client = {
      projects: async () => connection([{ name: "Auth" }, { name: "AUTH" }]),
    } as any;
    await expect(resolveProjectId(client, "auth")).rejects.toMatchObject({ code: "ambiguous" });
  });

  it("keeps exact-name precedence even when the name resembles an identifier", async () => {
    const { client, references } = canonicalClient();
    client.projects = async () => connection([{ id: "named-project", name: "P-TES-123" }]);
    expect(await resolveProjectId(client, "P-TES-123")).toBe("named-project");
    expect(references).toEqual([]);
  });

  it.each(["P-TES-123", "custom-reference", "P-OLD-7"])(
    "asks the server to resolve %s without imposing an identifier grammar",
    async (reference) => {
      const { client, references } = canonicalClient();
      expect(await resolveProjectId(client, reference)).toBe(UUID);
      expect(references).toEqual([reference]);
    },
  );

  it("normalizes a canonical miss but preserves authentication and API errors", async () => {
    for (const code of ["not_found", "auth", "forbidden", "api"] as const) {
      const { client } = canonicalClient();
      const error = new CliError("lookup failed", code);
      client.project = async () => {
        throw error;
      };
      await expect(resolveProjectId(client, "P-TES-999")).rejects.toMatchObject({ code });
      if (code !== "not_found")
        await expect(resolveProjectId(client, "P-TES-999")).rejects.toBe(error);
    }
  });

  it("uses the canonical UUID for issue filters, document targets and favorites", async () => {
    const { client } = canonicalClient();
    expect(await buildFilter(client, { project: "P-TES-123" }, undefined)).toEqual({
      project: { id: { eq: UUID } },
    });
    expect(await resolveTarget(client, { kind: "project", value: "P-TES-123" }, undefined)).toEqual(
      { kind: "project", id: UUID },
    );
    expect(await buildFavoriteInput(client, { project: "P-TES-123" })).toEqual({
      projectId: UUID,
    });
  });

  it("uses the canonical UUID for project updates and milestone lookups", async () => {
    const { client, references } = canonicalClient();
    const writes: any[] = [];
    client.updateProject = async (id: string, input: unknown) => {
      writes.push({ id, input });
      return { success: true, project: Promise.resolve({ id, name: "Auth", url: "u" }) };
    };
    await updateProject(client, "P-TES-123", { name: "Authentication" });
    expect(writes).toEqual([{ id: UUID, input: { name: "Authentication" } }]);
    expect(await listMilestones(client, "P-TES-123", 10)).toEqual([]);
    expect(references).toEqual(["P-TES-123", "P-TES-123", UUID]);
  });
});
