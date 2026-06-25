/**
 * Fixture janitor: sweep leaked live-test fixtures from the workspace.
 *
 * Live integration tests prefix everything they create with FIXTURE_PREFIX
 * (`clitest-…`). If a run dies before `afterAll` cleans up, this script removes
 * the strays. Safe to run anytime; only touches prefixed resources.
 *
 * Run: pnpm janitor   (needs LINEAR_API_KEY)
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

  // Projects.
  const projects = await client.projects({ filter: { name: { startsWith: PREFIX } }, first: 100 });
  for (const project of projects.nodes) {
    await client.deleteProject(project.id);
    console.error(`deleted project "${project.name}"`);
    removed++;
  }

  console.error(`janitor: removed ${removed} fixture(s).`);
}

main().catch((err) => {
  console.error("janitor failed:", err.message);
  process.exit(1);
});
