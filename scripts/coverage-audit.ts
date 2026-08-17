/**
 * Coverage audit: enumerate every LinearClient member, classify each as
 * `curated` / `raw-only` / `excluded`, and write COVERAGE.md. Fails (exit 1)
 * if any member is unclassified, so coverage claims can't silently rot.
 *
 * Run: bun run audit:coverage
 */

import { LinearClient } from "@linear/sdk";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UPDATE = process.argv.includes("--update");

/** Members that curated commands cover. Updated as each phase lands. */
const CURATED: Record<string, string[]> = {
  // phase 0
  meta: ["viewer", "organization"],
  // phase 1 — issues
  issue: [
    "issue",
    "issues",
    "createIssue",
    "updateIssue",
    "deleteIssue",
    "archiveIssue",
    "unarchiveIssue",
    "issueSubscribe",
    "issueUnsubscribe",
    "searchIssues",
    "issueSearch",
    "createIssueRelation",
    "deleteIssueRelation",
    "issueRelation",
    "issueRelations",
    "createComment",
    // `issue agent-session list/view` — the sessions agents open on issues.
    "agentSessions",
    "agentSession",
  ],
  // phase 2 — teams, projects, milestones, cycles
  // (`updateIssueBatch` is what `team delete --move-issues` moves the issues with)
  team: ["teams", "team", "createTeam", "updateTeam", "deleteTeam", "updateIssueBatch"],
  project: [
    "projects",
    "project",
    "createProject",
    "updateProject",
    "archiveProject",
    "deleteProject",
    "projectStatuses",
  ],
  // phase 3 (parity) — project & initiative status updates
  "project-update": ["projectUpdates", "createProjectUpdate"],
  milestone: [
    "projectMilestone",
    "projectMilestones",
    "createProjectMilestone",
    "updateProjectMilestone",
    "deleteProjectMilestone",
  ],
  cycle: ["cycles", "cycle", "createCycle", "updateCycle"],
  // phase 3 — users, labels, workflow states, comments, documents, attachments, favorites
  // (viewer is already curated under `meta`; createComment under `issue` — not duplicated here)
  user: ["users", "user"],
  label: [
    "issueLabels",
    "issueLabel",
    "createIssueLabel",
    "updateIssueLabel",
    "deleteIssueLabel",
  ],
  state: ["workflowStates", "workflowState"],
  comment: ["comments", "comment", "updateComment", "deleteComment", "commentResolve", "commentUnresolve"],
  document: ["documents", "document", "createDocument", "updateDocument", "deleteDocument"],
  attachment: ["attachments", "attachment", "createAttachment", "deleteAttachment"],
  favorite: ["favorites", "favorite", "createFavorite", "deleteFavorite"],
  // phase 4 — initiatives, roadmaps, notifications, organization invites, webhooks
  // (`organization` member is already curated under `meta` — not duplicated here)
  initiative: [
    "initiatives",
    "initiative",
    "createInitiative",
    "updateInitiative",
    "deleteInitiative",
    "archiveInitiative",
    "unarchiveInitiative",
    // `initiative add-project` / `remove-project` — the InitiativeToProject link.
    "createInitiativeToProject",
    "deleteInitiativeToProject",
    // Initiative labels went public in @linear/sdk 88.2 (previously [Internal]);
    // `initiative create/update --label` reads them to resolve names to ids.
    "initiativeLabels",
  ],
  "initiative-update": ["initiativeUpdates", "createInitiativeUpdate"],
  roadmap: ["roadmaps", "roadmap", "createRoadmap", "updateRoadmap", "deleteRoadmap"],
  notification: [
    "notifications",
    "notification",
    "updateNotification",
    "archiveNotification",
    "notificationMarkReadAll",
  ],
  organization: ["organizationInvites", "organizationInvite"],
  webhook: ["webhooks", "webhook", "createWebhook", "updateWebhook", "deleteWebhook"],
  // later phases append here (…)
};

/**
 * Patterns for members intentionally left to the raw `api` command or excluded.
 * `excluded` carries a reason; everything not curated and not excluded is
 * reported as `raw-only` (reachable via `linear api`).
 */
const EXCLUDED: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^(paginate|options|client|rateLimitStatus|applicationInfo)$/, reason: "SDK plumbing" },
  { pattern: /Auth|auth(entication)?Session|ssoUrl|samlToken|emailToken|googleUser|logout/i, reason: "auth/session flows (out of scope)" },
  { pattern: /^(suspendUser|unsuspendUser|userChangeRole|userRevoke|userUnlink|deleteOrganization|organizationDeleteChallenge|createOrganizationInvite|deleteOrganizationInvite)/, reason: "admin/enterprise (raw api only)" },
  { pattern: /integration|airbyte|trackAnonymousEvent|imageUpload|importFile|issueImport/i, reason: "integration/import (raw api only)" },
  { pattern: /release|customer|agent|emoji|template|timeSchedule|triage|pushSubscription|customView|gitAutomation|entityExternalLink|notificationSubscription|viewPreferences|slaConfig|auditEntr|semanticSearch|externalUser|contact|csvExport/i, reason: "specialized/raw api only" },
];

function clientMembers(): string[] {
  const c = new LinearClient({ apiKey: "x" });
  const names = new Set<string>();
  let o: any = c;
  while (o && o !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(o)) names.add(n);
    o = Object.getPrototypeOf(o);
  }
  return [...names].filter((n) => !n.startsWith("_") && n !== "constructor").sort();
}

type Status = "curated" | "raw-only" | "excluded";

function classify(member: string): { status: Status; note: string } {
  for (const [group, members] of Object.entries(CURATED)) {
    if (members.includes(member)) return { status: "curated", note: group };
  }
  for (const { pattern, reason } of EXCLUDED) {
    if (pattern.test(member)) return { status: "excluded", note: reason };
  }
  return { status: "raw-only", note: "reachable via `linear api`" };
}

function main(): void {
  const members = clientMembers();
  const rows = members.map((m) => ({ member: m, ...classify(m) }));

  const counts = rows.reduce<Record<Status, number>>(
    (acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc),
    { curated: 0, "raw-only": 0, excluded: 0 },
  );

  const curatedRows = rows.filter((r) => r.status === "curated");
  const excludedRows = rows.filter((r) => r.status === "excluded");
  const rawRows = rows.filter((r) => r.status === "raw-only");

  const md = [
    "# SDK Coverage Audit",
    "",
    `Generated by \`bun run audit:coverage\`. Total LinearClient members: **${members.length}**.`,
    "",
    "| Status | Count | Meaning |",
    "| --- | --- | --- |",
    `| curated | ${counts.curated} | Has a first-class CLI command |`,
    `| raw-only | ${counts["raw-only"]} | Reachable via \`linear api\` (no bespoke command) |`,
    `| excluded | ${counts.excluded} | Out of scope (admin/integration/SDK plumbing) |`,
    "",
    "Every member is classified — CI fails otherwise. `raw-only` members are still",
    "100% reachable through the raw GraphQL escape hatch; they simply lack a tailored command.",
    "",
    `## Curated (${curatedRows.length})`,
    "",
    curatedRows.map((r) => `- \`${r.member}\` — ${r.note}`).join("\n") || "_none yet_",
    "",
    `## Excluded (${excludedRows.length})`,
    "",
    excludedRows.map((r) => `- \`${r.member}\` — ${r.note}`).join("\n"),
    "",
    `## Raw-only (${rawRows.length})`,
    "",
    "<details><summary>Show</summary>",
    "",
    rawRows.map((r) => `- \`${r.member}\``).join("\n"),
    "",
    "</details>",
    "",
  ].join("\n");

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, "..", "COVERAGE.md");
  const snapshotPath = join(here, "coverage.snapshot.json");
  writeFileSync(outPath, md);

  console.error(
    `coverage: ${counts.curated} curated, ${counts["raw-only"]} raw-only, ${counts.excluded} excluded ` +
      `(${members.length} total) → ${outPath}`,
  );

  // The committed snapshot is the source of truth for "every member is accounted
  // for". The audit fails on any drift (new SDK member, removed member, or a
  // member whose classification changed) unless run with --update, which
  // re-baselines the snapshot. CI runs without --update, so an unhandled SDK
  // upgrade or a curated command that forgot to register fails the build.
  const current: Record<string, Status> = Object.fromEntries(rows.map((r) => [r.member, r.status]));

  if (UPDATE) {
    writeFileSync(snapshotPath, JSON.stringify(current, null, 2) + "\n");
    console.error(`snapshot updated → ${snapshotPath}`);
    return;
  }

  if (!existsSync(snapshotPath)) {
    console.error("No coverage snapshot found. Run `bun run audit:coverage --update` to create it.");
    process.exit(1);
  }

  const snapshot: Record<string, Status> = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const added = members.filter((m) => !(m in snapshot));
  const removed = Object.keys(snapshot).filter((m) => !current[m]);
  const changed = members.filter((m) => m in snapshot && snapshot[m] !== current[m]);

  if (added.length || removed.length || changed.length) {
    if (added.length) console.error(`UNCLASSIFIED / new members: ${added.join(", ")}`);
    if (removed.length) console.error(`removed members: ${removed.join(", ")}`);
    if (changed.length)
      console.error(
        `reclassified: ${changed.map((m) => `${m} (${snapshot[m]}→${current[m]})`).join(", ")}`,
      );
    console.error("Coverage drift detected. Re-baseline with `bun run audit:coverage --update`.");
    process.exit(1);
  }

  console.error("coverage snapshot is up to date.");
}

main();
