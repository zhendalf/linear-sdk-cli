import { describe, it, expect } from "bun:test";
import { buildFavoriteInput, entityLabel, favoriteName } from "../../src/services/favorite.js";
import { connection } from "./_fakes.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

/** A client whose issue/project lookups resolve to fixed ids. */
function makeClient() {
  return {
    // resolveIssue(TES-123) → issues({filter}) → first node
    issues: async () => connection([{ id: "issue-1", identifier: "TES-123" }]),
    issue: async (id: string) => ({ id, identifier: "TES-123" }),
    // resolveProjectId("Apollo") → projects({filter}) → first node
    projects: async () => connection([{ id: "proj-1", name: "Apollo" }]),
  } as any;
}

describe("buildFavoriteInput", () => {
  it("resolves an issue identifier to { issueId }", async () => {
    const input = await buildFavoriteInput(makeClient(), { issue: "TES-123" });
    expect(input).toEqual({ issueId: "issue-1" });
  });

  it("resolves a project name to { projectId }", async () => {
    const input = await buildFavoriteInput(makeClient(), { project: "Apollo" });
    expect(input).toEqual({ projectId: "proj-1" });
  });

  it("passes a document UUID through as { documentId }", async () => {
    const input = await buildFavoriteInput(makeClient(), { document: UUID });
    expect(input).toEqual({ documentId: UUID });
  });

  it("rejects a non-UUID document reference", async () => {
    await expect(
      buildFavoriteInput(makeClient(), { document: "not-a-uuid" }),
    ).rejects.toMatchObject({ code: "usage" });
  });

  it("throws a usage error when no target is given", async () => {
    await expect(buildFavoriteInput(makeClient(), {})).rejects.toMatchObject({
      code: "usage",
    });
  });

  it("throws a usage error when more than one target is given", async () => {
    await expect(
      buildFavoriteInput(makeClient(), { issue: "TES-123", project: "Apollo" }),
    ).rejects.toMatchObject({ code: "usage" });
  });

  it("treats an empty-string option as absent (still a usage error)", async () => {
    await expect(buildFavoriteInput(makeClient(), { issue: "" })).rejects.toMatchObject({
      code: "usage",
    });
  });
});

describe("entityLabel", () => {
  it("combines identifier + title for issues", () => {
    expect(entityLabel({ identifier: "TES-9", title: "Fix bug" })).toBe("TES-9 Fix bug");
  });
  it("uses name for projects/labels", () => {
    expect(entityLabel({ name: "Apollo" })).toBe("Apollo");
  });
  it("uses title for documents", () => {
    expect(entityLabel({ title: "Spec" })).toBe("Spec");
  });
  it("falls back to displayName, then key, then id", () => {
    expect(entityLabel({ displayName: "Ada" })).toBe("Ada");
    expect(entityLabel({ key: "TES" })).toBe("TES");
    expect(entityLabel({ id: "x" })).toBe("x");
  });
});

describe("favoriteName", () => {
  it("resolves the entity named by the favorite's type", async () => {
    const fav = {
      type: "issue",
      issue: Promise.resolve({ identifier: "TES-1", title: "Hello" }),
    };
    expect(await favoriteName(fav)).toBe("TES-1 Hello");
  });

  it("uses folderName for folder favorites without touching getters", async () => {
    expect(await favoriteName({ type: "folder", folderName: "Work" })).toBe("Work");
  });

  it("uses predefinedViewType for predefined-view favorites", async () => {
    expect(await favoriteName({ type: "predefinedView", predefinedViewType: "triage" })).toBe(
      "triage",
    );
  });

  it("resolves a project favorite to its name", async () => {
    const fav = { type: "project", project: Promise.resolve({ name: "Apollo" }) };
    expect(await favoriteName(fav)).toBe("Apollo");
  });
});
