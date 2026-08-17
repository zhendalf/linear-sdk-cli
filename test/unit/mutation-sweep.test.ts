/**
 * The class-of-bug test for AUDIT #6.
 *
 * Every mutating service entry point is driven against a client whose reads all
 * succeed and whose *writes* all answer `{ success: false }` — the shape Linear
 * returns when it refuses a mutation. Each one must fail, with the `api` code
 * and exit 1, rather than printing a receipt for something that never happened.
 *
 * Before the fix, twenty of these resolved happily: `updateIssue` handed back
 * the pre-mutation issue, and every delete/archive/subscribe threw the payload
 * away unread. Per-service unit tests covered the *inputs* these functions
 * build; nothing covered what they do with the answer, which is why the defect
 * was spread across the whole layer rather than confined to one file.
 */

import { describe, it, expect } from "bun:test";
import { connection } from "./_fakes.js";

import * as attachment from "../../src/services/attachment.js";
import * as comment from "../../src/services/comment.js";
import * as cycle from "../../src/services/cycle.js";
import * as document from "../../src/services/document.js";
import * as favorite from "../../src/services/favorite.js";
import * as initiative from "../../src/services/initiative.js";
import * as initiativeUpdate from "../../src/services/initiative-update.js";
import * as issue from "../../src/services/issue.js";
import * as label from "../../src/services/label.js";
import * as milestone from "../../src/services/milestone.js";
import * as notification from "../../src/services/notification.js";
import * as project from "../../src/services/project.js";
import * as projectUpdate from "../../src/services/project-update.js";
import * as roadmap from "../../src/services/roadmap.js";
import * as team from "../../src/services/team.js";
import * as webhook from "../../src/services/webhook.js";

const UUID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

/**
 * A client whose every read works and whose every write is refused. The reads
 * are deliberately generous — one object answers for issue, project, label,
 * milestone, … — because the point of this file is the *write* path.
 */
function refusingClient(): any {
  const entity: any = {
    id: UUID,
    identifier: "TES-1",
    number: 1,
    title: "Title",
    name: "Name",
    key: "TES",
    url: "https://linear.app/x",
    label: null,
    enabled: true,
    resourceTypes: ["Issue"],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    team: Promise.resolve({ id: "team-1", key: "TES", name: "Test" }),
    creator: Promise.resolve(null),
    project: Promise.resolve(null),
    relations: async () => connection([]),
    inverseRelations: async () => connection([]),
  };
  const teamModel = {
    id: "team-1",
    key: "TES",
    name: "Test",
    activeCycle: Promise.resolve({ id: UUID, number: 1 }),
    states: async () =>
      connection([{ id: "state-1", name: "In Progress", type: "started", position: 1 }]),
    cycles: async () => connection([{ id: UUID, number: 1, name: "Sprint One" }]),
  };
  const refused = async () => ({ success: false, lastSyncId: 1 });
  const refusedWith = (key: string) => async () => ({
    success: false,
    lastSyncId: 1,
    [key]: Promise.resolve(null),
  });

  return {
    // ---- reads ------------------------------------------------------------
    viewer: Promise.resolve({ id: "me" }),
    issues: async () => connection([entity]),
    issue: async () => entity,
    teams: async () => connection([teamModel]),
    team: async () => teamModel,
    projects: async () => connection([entity]),
    project: async () => ({
      ...entity,
      projectMilestones: async () => connection([{ id: UUID, name: "Name" }]),
    }),
    users: async () => connection([{ id: "user-1", email: "a@b.c" }]),
    issueLabels: async () => connection([{ id: "lbl", name: "bug", team: Promise.resolve(null) }]),
    issueLabel: async () => entity,
    projectLabels: async () => connection([{ id: "lbl", name: "bug", isGroup: false }]),
    initiativeLabels: async () => connection([{ id: "lbl", name: "bug", isGroup: false }]),
    projectMilestone: async () => entity,
    initiative: async () => entity,
    initiatives: async () => connection([entity]),
    roadmap: async () => entity,
    roadmaps: async () => connection([entity]),
    document: async () => entity,
    webhook: async () => entity,
    attachment: async () => entity,
    client: {
      rawRequest: async (query: string) => {
        if (query.includes("CliCommentLookup")) {
          return {
            data: {
              comment: { id: "c1", issueId: UUID, issue: { id: UUID, identifier: "TES-1" } },
            },
          };
        }
        // markAllRead enumerates unread notifications before writing.
        return {
          data: {
            notifications: {
              nodes: [
                {
                  __typename: "IssueNotification",
                  id: "n1",
                  type: "issueAssigned",
                  readAt: null,
                  snoozedUntilAt: null,
                  archivedAt: null,
                  createdAt: "2026-01-01T00:00:00.000Z",
                },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        };
      },
    },

    // ---- writes, all refused ---------------------------------------------
    createAttachment: refusedWith("attachment"),
    deleteAttachment: refused,
    createComment: refusedWith("comment"),
    updateComment: refusedWith("comment"),
    deleteComment: refused,
    commentResolve: refusedWith("comment"),
    commentUnresolve: refusedWith("comment"),
    createCycle: refusedWith("cycle"),
    updateCycle: refusedWith("cycle"),
    createDocument: refusedWith("document"),
    updateDocument: refusedWith("document"),
    deleteDocument: refused,
    createFavorite: refusedWith("favorite"),
    deleteFavorite: refused,
    createInitiative: refusedWith("initiative"),
    updateInitiative: refusedWith("initiative"),
    archiveInitiative: refused,
    deleteInitiative: refused,
    createInitiativeUpdate: refusedWith("initiativeUpdate"),
    createIssue: refusedWith("issue"),
    updateIssue: refusedWith("issue"),
    archiveIssue: refused,
    unarchiveIssue: refused,
    deleteIssue: refused,
    issueSubscribe: refused,
    issueUnsubscribe: refused,
    createIssueRelation: refused,
    deleteIssueRelation: refused,
    createIssueLabel: refusedWith("issueLabel"),
    updateIssueLabel: refusedWith("issueLabel"),
    deleteIssueLabel: refused,
    createProjectMilestone: refusedWith("projectMilestone"),
    updateProjectMilestone: refusedWith("projectMilestone"),
    deleteProjectMilestone: refused,
    updateNotification: refused,
    archiveNotification: refused,
    createProject: refusedWith("project"),
    updateProject: refusedWith("project"),
    archiveProject: refused,
    createProjectUpdate: refusedWith("projectUpdate"),
    createRoadmap: refusedWith("roadmap"),
    updateRoadmap: refusedWith("roadmap"),
    deleteRoadmap: refused,
    createTeam: refusedWith("team"),
    updateTeam: refusedWith("team"),
    createWebhook: refusedWith("webhook"),
    updateWebhook: refusedWith("webhook"),
    deleteWebhook: refused,
  };
}

/** Every mutating entry point in `src/services`, by the file it lives in. */
const MUTATIONS: Array<[string, (c: any) => Promise<unknown>]> = [
  ["attachment.createAttachment", (c) => attachment.createAttachment(c, "TES-1", { url: "u", title: "t" })],
  ["attachment.deleteAttachment", (c) => attachment.deleteAttachment(c, UUID)],
  ["comment.addComment", (c) => comment.addComment(c, "TES-1", "body")],
  ["comment.replyToComment", (c) => comment.replyToComment(c, "c1", "body")],
  ["comment.updateComment", (c) => comment.updateComment(c, "c1", "body")],
  ["comment.deleteComment", (c) => comment.deleteComment(c, "c1")],
  ["comment.setResolved(true)", (c) => comment.setResolved(c, "c1", true)],
  ["comment.setResolved(false)", (c) => comment.setResolved(c, "c1", false)],
  ["cycle.createCycle", (c) => cycle.createCycle(c, { startsAt: "2026-01-01", endsAt: "2026-01-14" }, "TES")],
  ["cycle.updateCycle", (c) => cycle.updateCycle(c, UUID, { name: "n" }, "TES", undefined)],
  ["document.createDocument", (c) => document.createDocument(c, { title: "t", project: UUID })],
  ["document.updateDocument", (c) => document.updateDocument(c, UUID, { title: "t" })],
  ["document.deleteDocument", (c) => document.deleteDocument(c, UUID)],
  ["favorite.addFavorite", (c) => favorite.addFavorite(c, { issue: "TES-1" })],
  ["favorite.removeFavorite", (c) => favorite.removeFavorite(c, UUID)],
  ["initiative.createInitiative", (c) => initiative.createInitiative(c, { name: "n" })],
  ["initiative.updateInitiative", (c) => initiative.updateInitiative(c, UUID, { name: "n" })],
  ["initiative.archiveInitiative", (c) => initiative.archiveInitiative(c, UUID)],
  ["initiative.deleteInitiative", (c) => initiative.deleteInitiative(c, UUID)],
  ["initiative-update.createInitiativeUpdate", (c) => initiativeUpdate.createInitiativeUpdate(c, UUID, { body: "b" })],
  ["issue.createIssue", (c) => issue.createIssue(c, { title: "t", team: "TES" }, "TES")],
  ["issue.updateIssue", (c) => issue.updateIssue(c, "TES-1", { title: "t" })],
  ["issue.archiveIssue", (c) => issue.archiveIssue(c, "TES-1", false)],
  ["issue.unarchiveIssue", (c) => issue.archiveIssue(c, "TES-1", true)],
  ["issue.deleteIssue", (c) => issue.deleteIssue(c, "TES-1")],
  ["issue.setSubscription(true)", (c) => issue.setSubscription(c, "TES-1", true)],
  ["issue.setSubscription(false)", (c) => issue.setSubscription(c, "TES-1", false)],
  ["issue.startIssue", (c) => issue.startIssue(c, "TES-1", { move: true })],
  ["issue.addRelation", (c) => issue.addRemoveRelation(c, "TES-1", "add", "blocks", "TES-2")],
  ["label.createLabel", (c) => label.createLabel(c, { name: "n" }, undefined)],
  ["label.updateLabel", (c) => label.updateLabel(c, UUID, { name: "n" })],
  ["label.deleteLabel", (c) => label.deleteLabel(c, UUID)],
  ["milestone.createMilestone", (c) => milestone.createMilestone(c, UUID, { name: "n" })],
  ["milestone.updateMilestone", (c) => milestone.updateMilestone(c, UUID, { name: "n" })],
  ["milestone.deleteMilestone", (c) => milestone.deleteMilestone(c, UUID)],
  ["notification.setRead", (c) => notification.setRead(c, "n1", true)],
  ["notification.archiveNotification", (c) => notification.archiveNotification(c, "n1")],
  ["notification.snoozeNotification", (c) => notification.snoozeNotification(c, "n1", "2026-07-01T09:00:00Z")],
  ["project.createProject", (c) => project.createProject(c, { name: "n" }, "TES")],
  ["project.updateProject", (c) => project.updateProject(c, UUID, { name: "n" })],
  ["project.archiveProject", (c) => project.archiveProject(c, UUID)],
  ["project-update.createProjectUpdate", (c) => projectUpdate.createProjectUpdate(c, UUID, { body: "b" })],
  ["roadmap.createRoadmap", (c) => roadmap.createRoadmap(c, { name: "n" })],
  ["roadmap.updateRoadmap", (c) => roadmap.updateRoadmap(c, UUID, { name: "n" })],
  ["roadmap.deleteRoadmap", (c) => roadmap.deleteRoadmap(c, UUID)],
  ["team.createTeam", (c) => team.createTeam(c, { name: "n" })],
  ["team.updateTeam", (c) => team.updateTeam(c, "TES", undefined, { name: "n" })],
  ["webhook.createWebhook", (c) => webhook.createWebhook(c, { url: "https://x/h", resourceTypes: ["Issue"], team: "TES" })],
  ["webhook.updateWebhook", (c) => webhook.updateWebhook(c, UUID, { enabled: false })],
  ["webhook.deleteWebhook", (c) => webhook.deleteWebhook(c, UUID)],
];

describe("every service mutation refuses to report a success the API did not give", () => {
  for (const [name, run] of MUTATIONS) {
    it(name, async () => {
      await expect(run(refusingClient())).rejects.toMatchObject({ code: "api", exitCode: 1 });
    });
  }
});

/**
 * The sharper half of the same defect. The create/update paths did have a
 * guard, but it tested the *entity*, not `success` — so a refusal that still
 * carried an entity walked straight through it and got printed as a receipt.
 * Here every write answers `{ success: false, <entity>: … }`.
 */
describe("a refusal that still carries an entity is not a success either", () => {
  function refusingWithEntity(): any {
    const c = refusingClient();
    const carried = { id: UUID, identifier: "TES-1", name: "Name", title: "Title", url: "u" };
    for (const key of Object.keys(c)) {
      if (!/^(create|update|archive|unarchive|delete|comment|issueS|issueU)/.test(key)) continue;
      const entityKey = ENTITY_KEY[key];
      if (!entityKey) continue;
      c[key] = async () => ({
        success: false,
        lastSyncId: 1,
        [entityKey]: Promise.resolve({ ...carried, user: Promise.resolve(null), createdAt: new Date() }),
      });
    }
    return c;
  }

  for (const [name, run] of MUTATIONS) {
    it(name, async () => {
      await expect(run(refusingWithEntity())).rejects.toMatchObject({ code: "api" });
    });
  }
});

/** Which payload field each mutation carries its entity in. */
const ENTITY_KEY: Record<string, string> = {
  createAttachment: "attachment",
  createComment: "comment",
  updateComment: "comment",
  commentResolve: "comment",
  commentUnresolve: "comment",
  createCycle: "cycle",
  updateCycle: "cycle",
  createDocument: "document",
  updateDocument: "document",
  createFavorite: "favorite",
  createInitiative: "initiative",
  updateInitiative: "initiative",
  createInitiativeUpdate: "initiativeUpdate",
  createIssue: "issue",
  updateIssue: "issue",
  createIssueLabel: "issueLabel",
  updateIssueLabel: "issueLabel",
  createProjectMilestone: "projectMilestone",
  updateProjectMilestone: "projectMilestone",
  createProject: "project",
  updateProject: "project",
  createProjectUpdate: "projectUpdate",
  createRoadmap: "roadmap",
  updateRoadmap: "roadmap",
  createTeam: "team",
  updateTeam: "team",
  createWebhook: "webhook",
  updateWebhook: "webhook",
};

// `removeRelation` reaches the delete only after finding a relation record, so
// it needs a client whose relation lookup returns a match.
describe("relation removal", () => {
  it("fails when the API refuses the delete", async () => {
    const relation = {
      id: "rel-1",
      type: "blocks",
      issue: Promise.resolve({ id: UUID }),
      relatedIssue: Promise.resolve({ id: OTHER }),
    };
    const from = {
      id: UUID,
      identifier: "TES-1",
      relations: async () => connection([relation]),
      inverseRelations: async () => connection([]),
    };
    const to = { id: OTHER, identifier: "TES-2" };
    const c = refusingClient();
    // resolveIssue is called for the subject then the other issue, in order.
    const resolved = [from, to];
    c.issues = async () => connection([resolved.shift() ?? to]);

    await expect(
      issue.addRemoveRelation(c, "TES-1", "remove", "blocks", "TES-2"),
    ).rejects.toMatchObject({ code: "api", exitCode: 1 });
  });
});

// The batch is the one mutation that must NOT throw on a per-item refusal —
// it reports what happened instead, which is the honest aggregate.
describe("notification.markAllRead", () => {
  it("reports the refusal rather than throwing or claiming success", async () => {
    const res = await notification.markAllRead(refusingClient());
    expect(res.success).toBe(false);
    expect(res.count).toBe(0);
    expect(res.attempted).toBe(1);
    expect(res.failed).toHaveLength(1);
  });
});
