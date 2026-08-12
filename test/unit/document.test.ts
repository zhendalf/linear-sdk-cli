import { describe, it, expect, vi } from "bun:test";
import {
  createDocument,
  updateDocument,
  deleteDocument,
  getDocumentDetail,
  listDocuments,
} from "../../src/services/document.js";

const UUID = "01234567-89ab-cdef-0123-456789abcdef";

describe("createDocument (input building)", () => {
  it("requires a container (project/issue/team)", async () => {
    const client = { createDocument: vi.fn() } as any;
    await expect(createDocument(client, { title: "Spec" })).rejects.toMatchObject({
      code: "usage",
    });
  });

  it("resolves a team container to teamId", async () => {
    const createDocumentMock = vi.fn().mockResolvedValue({
      document: Promise.resolve({ id: "d1", title: "Spec", url: "u" }),
    });
    const client = {
      createDocument: createDocumentMock,
      teams: vi.fn().mockResolvedValue({ nodes: [{ id: "team-1", key: "TES", name: "Test" }] }),
    } as any;

    const doc = await createDocument(client, { title: "Spec", team: "TES" });
    expect(createDocumentMock).toHaveBeenCalledWith({ title: "Spec", teamId: "team-1" });
    expect(doc.id).toBe("d1");
  });

  it("includes content when provided (including empty string)", async () => {
    const createDocumentMock = vi.fn().mockResolvedValue({
      document: Promise.resolve({ id: "d2", title: "T", url: "u" }),
    });
    const client = { createDocument: createDocumentMock } as any;

    await createDocument(client, { title: "T", content: "", project: UUID });
    expect(createDocumentMock).toHaveBeenCalledWith({ title: "T", content: "", projectId: UUID });
  });

  it("rejects more than one container", async () => {
    const client = { createDocument: vi.fn() } as any;
    await expect(
      createDocument(client, { title: "T", project: UUID, issue: "TES-1" }),
    ).rejects.toMatchObject({ code: "usage" });
  });

  it("resolves a project name to projectId", async () => {
    const createDocumentMock = vi.fn().mockResolvedValue({
      document: Promise.resolve({ id: "d3", title: "T", url: "u" }),
    });
    const client = {
      createDocument: createDocumentMock,
      projects: vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "proj-1", name: "Roadmap" }] }),
    } as any;

    await createDocument(client, { title: "T", project: "Roadmap" });
    expect(createDocumentMock).toHaveBeenCalledWith({ title: "T", projectId: "proj-1" });
  });

  it("passes a project uuid through directly without a lookup", async () => {
    const createDocumentMock = vi.fn().mockResolvedValue({
      document: Promise.resolve({ id: "d4", title: "T", url: "u" }),
    });
    const projectsMock = vi.fn();
    const client = { createDocument: createDocumentMock, projects: projectsMock } as any;

    await createDocument(client, { title: "T", project: UUID });
    expect(projectsMock).not.toHaveBeenCalled();
    expect(createDocumentMock).toHaveBeenCalledWith({ title: "T", projectId: UUID });
  });

  it("throws a usage error when the payload has no document", async () => {
    const client = {
      createDocument: vi.fn().mockResolvedValue({ document: Promise.resolve(null) }),
    } as any;
    // Pass a uuid container so we reach the payload check, not the container guard.
    await expect(createDocument(client, { title: "T", project: UUID })).rejects.toMatchObject({
      code: "usage",
    });
  });
});

describe("updateDocument (guards + input building)", () => {
  it("throws a usage error when nothing is passed", async () => {
    const client = { document: vi.fn().mockResolvedValue({ id: UUID }) } as any;
    await expect(updateDocument(client, UUID, {})).rejects.toMatchObject({
      code: "usage",
    });
  });

  it("sends only the fields provided", async () => {
    const updateDocumentMock = vi.fn().mockResolvedValue({
      document: Promise.resolve({ id: UUID, title: "New", url: "u" }),
    });
    const client = {
      document: vi.fn().mockResolvedValue({ id: UUID }),
      updateDocument: updateDocumentMock,
    } as any;

    await updateDocument(client, UUID, { title: "New" });
    expect(updateDocumentMock).toHaveBeenCalledWith(UUID, { title: "New" });
  });
});

describe("getDocumentDetail / deleteDocument (relation unwrapping)", () => {
  it("flattens project/issue/creator getters into display strings", async () => {
    const document = {
      id: UUID,
      title: "Design",
      content: "# hi",
      url: "https://linear.app/x",
      slugId: "abc",
      icon: null,
      color: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z"),
      project: Promise.resolve({ name: "Roadmap" }),
      issue: Promise.resolve({ identifier: "TES-1" }),
      creator: Promise.resolve({ displayName: "Ada" }),
    };
    const client = { document: vi.fn().mockResolvedValue(document) } as any;

    const detail = await getDocumentDetail(client, UUID);
    expect(detail.project).toBe("Roadmap");
    expect(detail.issue).toBe("TES-1");
    expect(detail.creator).toBe("Ada");
    expect(detail.content).toBe("# hi");
  });

  it("deletes by id and returns the resolved document", async () => {
    const deleteDocumentMock = vi.fn().mockResolvedValue({ success: true });
    const client = {
      document: vi.fn().mockResolvedValue({ id: UUID, title: "Gone" }),
      deleteDocument: deleteDocumentMock,
    } as any;

    const doc = await deleteDocument(client, UUID);
    expect(deleteDocumentMock).toHaveBeenCalledWith(UUID);
    expect(doc.id).toBe(UUID);
  });
});

describe("listDocuments (container filters)", () => {
  const UUID = "01234567-89ab-cdef-0123-456789abcdef";

  function stub(sent: any[]) {
    return {
      projects: async () => ({ nodes: [{ id: "proj-1", name: "Auth" }] }),
      issues: async () => ({ nodes: [{ id: "issue-1", identifier: "TES-1" }] }),
      client: {
        rawRequest: async (_q: string, vars: any) => {
          sent.push(vars);
          return { data: { documents: { nodes: [], pageInfo: { hasNextPage: false } } } };
        },
      },
    } as any;
  }

  it("sends no filter when unfiltered", async () => {
    const sent: any[] = [];
    await listDocuments(stub(sent), 50);
    expect(sent[0].filter).toBeUndefined();
  });

  // DocumentFilter matches containers by id, so a human reference is resolved first.
  it("resolves a project name and an issue identifier to ids", async () => {
    const sent: any[] = [];
    await listDocuments(stub(sent), 50, { project: "Auth", issue: "TES-1" });
    expect(sent[0].filter).toEqual({
      project: { id: { eq: "proj-1" } },
      issue: { id: { eq: "issue-1" } },
    });
  });

  it("passes a project uuid straight through", async () => {
    const sent: any[] = [];
    await listDocuments(stub(sent), 50, { project: UUID });
    expect(sent[0].filter).toEqual({ project: { id: { eq: UUID } } });
  });
});
