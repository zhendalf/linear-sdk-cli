/**
 * Fixture janitor: sweep leaked live-test fixtures from the workspace.
 *
 * Live integration tests prefix everything they create with FIXTURE_PREFIX
 * (`clitest-…`). If a run dies before `afterAll` cleans up, this script removes
 * the strays. Safe to run anytime; only touches prefixed resources.
 *
 * Run: bun run janitor   (needs LINEAR_API_KEY)
 */

import { LinearClient } from "@linear/sdk";

const PREFIX = "clitest-";

async function main(): Promise<void> {
  const apiKey = process.env.LINEAR_API_KEY || process.env.LINEAR_API_TOKEN;
  if (!apiKey) {
    console.error("janitor: set LINEAR_API_KEY to sweep fixtures.");
    process.exit(2);
  }
  const client = new LinearClient({ apiKey });
  let removed = 0;

  // Issues (search by title prefix; delete = move to trash).
  const issues = await client.issues({
    filter: { title: { startsWith: PREFIX } },
    first: 100,
    includeArchived: true,
  });
  for (const issue of issues.nodes) {
    // `includeArchived` also returns already-trashed issues; deleting those just
    // re-trashes the same set forever. Only act on live/archived (non-trashed) ones.
    if (issue.trashed) continue;
    await client.deleteIssue(issue.id);
    console.error(`deleted issue ${issue.identifier} "${issue.title}"`);
    removed++;
  }

  // Labels.
  const labels = await client.issueLabels({ filter: { name: { startsWith: PREFIX } }, first: 100 });
  for (const label of labels.nodes) {
    await client.deleteIssueLabel(label.id);
    console.error(`deleted label "${label.name}"`);
    removed++;
  }

  // Projects. Tests archive (not delete) projects in teardown, so sweep archived
  // ones too; skip already-trashed to avoid re-deleting the same returned set.
  const projects = await client.projects({
    filter: { name: { startsWith: PREFIX } },
    first: 100,
    includeArchived: true,
  });
  for (const project of projects.nodes) {
    if (project.trashed) continue;
    await client.deleteProject(project.id);
    console.error(`deleted project "${project.name}"`);
    removed++;
  }

  // Initiatives and initiative labels. Both are plan-gated, so a workspace
  // without the feature errors here rather than returning an empty list — that
  // is not a janitor failure, so it is tolerated.
  try {
    const initiatives = await client.initiatives({ first: 100, includeArchived: true });
    for (const initiative of initiatives.nodes) {
      if (!initiative.name.startsWith(PREFIX)) continue;
      await client.deleteInitiative(initiative.id);
      console.error(`deleted initiative "${initiative.name}"`);
      removed++;
    }

    const initiativeLabels: any = await (client as any).initiativeLabels({
      filter: { name: { startsWith: PREFIX } },
      first: 100,
    });
    for (const label of initiativeLabels.nodes) {
      await (client as any).deleteInitiativeLabel(label.id);
      console.error(`deleted initiative label "${label.name}"`);
      removed++;
    }
  } catch (err) {
    console.error(`janitor: skipped initiatives (${(err as Error).message})`);
  }

  console.error(`janitor: removed ${removed} fixture(s).`);
}

main().catch((err) => {
  console.error("janitor failed:", err.message);
  process.exit(1);
});
