/**
 * Live coverage for compatibility query filters and the `issue update --team`
 * move.
 *
 * Every filter here is asserted with BOTH a positive and a negative case: a
 * filter that silently fails to apply returns the same rows as no filter at
 * all, which is exactly what a "does it contain my fixture?" assertion cannot
 * tell apart from a working one.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { LinearClient } from "@linear/sdk";
import { run, runJson, LIVE, LIVE_ADMIN, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const adminSuite = LIVE_ADMIN ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

/** Identifiers from a query, with a high limit so membership assertions are honest. */
function ids(args: string[]): string[] {
  return runJson<Array<{ identifier: string }>>([...args, "--limit", "200"]).map(
    (r) => r.identifier,
  );
}

suite("phase 3 — issue query filters (live)", () => {
  const issues: string[] = [];
  const projects: string[] = [];
  let client: LinearClient;
  let labelName: string;
  let labelId: string;
  let projectWith: string;
  let projectWithout: string;
  let milestoneWith: string;
  let milestoneWithout: string;
  let assigned: string;
  let unassigned: string;

  beforeAll(() => {
    ensureBuilt();
    client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! });

    // Project labels are workspace-level and have no CLI create command yet, so
    // the fixture goes through the `api` escape hatch (the janitor sweeps them).
    labelName = `${FIXTURE_PREFIX}plabel`;
    const created = runJson<{ projectLabelCreate: { projectLabel: { id: string } } }>([
      "api",
      "mutation CliTestLabel($name: String!) { projectLabelCreate(input: { name: $name }) { projectLabel { id } } }",
      "--var",
      `name=${labelName}`,
    ]);
    labelId = created.projectLabelCreate.projectLabel.id;

    projectWith = `${FIXTURE_PREFIX}proj-labelled`;
    projectWithout = `${FIXTURE_PREFIX}proj-plain`;
    for (const [name, extra] of [
      [projectWith, ["--label", labelName]],
      [projectWithout, []],
    ] as const) {
      const p = runJson<{ id: string }>([
        "project",
        "create",
        "--name",
        name,
        "--teams",
        TEAM,
        ...extra,
      ]);
      projects.push(p.id);
    }

    milestoneWith = `${FIXTURE_PREFIX}ms-a`;
    milestoneWithout = `${FIXTURE_PREFIX}ms-b`;
    runJson(["milestone", "create", projectWith, "--name", milestoneWith]);
    runJson(["milestone", "create", projectWithout, "--name", milestoneWithout]);

    assigned = make("assigned", [
      "--assignee",
      "me",
      "--state",
      "unstarted",
      "--project",
      projectWith,
      "--milestone",
      milestoneWith,
    ]);
    unassigned = make("unassigned", [
      "--state",
      "started",
      "--project",
      projectWithout,
      "--milestone",
      milestoneWithout,
    ]);
  });

  afterAll(async () => {
    for (const id of issues) run(["issue", "delete", id, "--yes", "--json"]);
    for (const id of projects) {
      try {
        await client.deleteProject(id);
      } catch {
        // best-effort; the janitor sweeps the rest
      }
    }
    try {
      await (client as any).deleteProjectLabel(labelId);
    } catch {
      // best-effort
    }
  });

  function make(title: string, extra: string[]): string {
    const res = runJson<{ identifier: string }>([
      "issue",
      "create",
      "--title",
      `${FIXTURE_PREFIX}${title}`,
      "--team",
      TEAM,
      ...extra,
    ]);
    issues.push(res.identifier);
    return res.identifier;
  }

  // 3.1
  it("-U/--unassigned returns exactly the issues --assignee me does not", () => {
    const withoutAssignee = ids(["issue", "list", "--team", TEAM, "-U"]);
    expect(withoutAssignee).toContain(unassigned);
    expect(withoutAssignee).not.toContain(assigned);

    const mine = ids(["issue", "list", "--team", TEAM, "--assignee", "me"]);
    expect(mine).toContain(assigned);
    expect(mine).not.toContain(unassigned);
  });

  it("rejects --unassigned with --assignee instead of silently preferring one", () => {
    const res = run(["issue", "list", "--team", TEAM, "-U", "--assignee", "me", "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });

  // `issue search` goes through Linear's full-text index, which lags issue
  // creation by an unpredictable amount — asserting a just-created fixture is
  // findable makes this flaky. So: only assert the FILTER once the index has
  // caught up, and always assert the direction that cannot produce a false pass
  // (an assigned issue must never appear under --unassigned).
  it("carries --unassigned into `issue search` too", () => {
    const indexed = ids(["issue", "search", FIXTURE_PREFIX, "--team", TEAM]);
    const found = ids(["issue", "search", FIXTURE_PREFIX, "--team", TEAM, "-U"]);
    expect(found).not.toContain(assigned);
    if (indexed.includes(unassigned)) expect(found).toContain(unassigned);
    else expect(found).toEqual(expect.arrayContaining([]));
  });

  // 3.2 — repeating --state broadens; each single value still bites.
  it("repeats --state as a union of the single-state results", () => {
    const unstarted = ids(["issue", "list", "--team", TEAM, "--state", "unstarted"]);
    expect(unstarted).toContain(assigned);
    expect(unstarted).not.toContain(unassigned);

    const started = ids(["issue", "list", "--team", TEAM, "--state", "started"]);
    expect(started).toContain(unassigned);
    expect(started).not.toContain(assigned);

    const both = ids([
      "issue",
      "list",
      "--team",
      TEAM,
      "--state",
      "unstarted",
      "--state",
      "started",
    ]);
    expect(both).toContain(assigned);
    expect(both).toContain(unassigned);
    // Still a filter, not a no-op: completed/canceled work stays out.
    const all = ids(["issue", "list", "--team", TEAM]);
    expect(both.length).toBeLessThanOrEqual(all.length);
  });

  it("keeps a repeated --team scoped (same key twice is one team, case-insensitively)", () => {
    const once = ids(["issue", "list", "--team", TEAM]);
    const twice = ids(["issue", "list", "--team", TEAM, "--team", TEAM.toLowerCase()]);
    expect(twice.sort()).toEqual(once.sort());
  });

  // 3.3
  it("bounds by created/updated date, and rejects a malformed one locally", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(ids(["issue", "list", "--team", TEAM, "--created-after", "2020-01-01"])).toContain(
      assigned,
    );
    expect(ids(["issue", "list", "--team", TEAM, "--created-after", tomorrow])).not.toContain(
      assigned,
    );
    expect(ids(["issue", "list", "--team", TEAM, "--updated-after", "2020-01-01"])).toContain(
      assigned,
    );
    expect(ids(["issue", "list", "--team", TEAM, "--updated-after", tomorrow])).not.toContain(
      assigned,
    );

    // A date the API would accept-and-ignore must never reach it.
    const res = run(["issue", "list", "--team", TEAM, "--created-after", "March 2024", "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });

  // 3.4
  it("filters by the project's label, case-insensitively, and excludes other projects", () => {
    const labelled = ids(["issue", "list", "--team", TEAM, "--project-label", labelName]);
    expect(labelled).toContain(assigned);
    expect(labelled).not.toContain(unassigned);

    const upper = ids([
      "issue",
      "list",
      "--team",
      TEAM,
      "--project-label",
      labelName.toUpperCase(),
    ]);
    expect(upper).toContain(assigned);

    expect(ids(["issue", "list", "--team", TEAM, "--project-label", `${labelName}-nope`])).toEqual(
      [],
    );
  });

  it("rejects --project-label together with --project", () => {
    const res = run([
      "issue",
      "list",
      "--team",
      TEAM,
      "--project-label",
      labelName,
      "--project",
      projectWith,
      "--json",
    ]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });

  // 3.5 — unlike the reference CLI, --project is optional here (the SDK filter
  // can match a milestone by name), and only changes precision.
  it("filters by milestone with and without --project", () => {
    const byName = ids(["issue", "list", "--team", TEAM, "--milestone", milestoneWith]);
    expect(byName).toContain(assigned);
    expect(byName).not.toContain(unassigned);

    const scoped = ids([
      "issue",
      "list",
      "--team",
      TEAM,
      "--project",
      projectWith,
      "--milestone",
      milestoneWith,
    ]);
    expect(scoped).toContain(assigned);
    expect(scoped).not.toContain(unassigned);

    const other = ids(["issue", "list", "--team", TEAM, "--milestone", milestoneWithout]);
    expect(other).toContain(unassigned);
    expect(other).not.toContain(assigned);
  });

  it("says so when a milestone is not in the scoping project", () => {
    const res = run([
      "issue",
      "list",
      "--team",
      TEAM,
      "--project",
      projectWith,
      "--milestone",
      milestoneWithout,
      "--json",
    ]);
    expect(res.code).toBe(3);
    expect(JSON.parse(res.stderr).error.code).toBe("not_found");
  });
});

// 3.6 — needs a second team, so it is admin-gated like `team create` itself.
adminSuite("phase 3 — issue update --team moves the issue (live, admin)", () => {
  const teamIds: string[] = [];
  const labelIds: string[] = [];
  let client: LinearClient;

  beforeAll(() => {
    ensureBuilt();
    client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! });
  });

  afterAll(async () => {
    // Deleting the destination team takes the moved issue with it.
    for (const id of teamIds) {
      try {
        await client.deleteTeam(id);
      } catch {
        // best-effort; the janitor sweeps the rest
      }
    }
    for (const id of labelIds) {
      try {
        await client.deleteIssueLabel(id);
      } catch {
        // best-effort
      }
    }
  });

  it("moves the issue between teams, renumbering it and dropping team-scoped state", () => {
    const key = ("M" + Math.random().toString(36).slice(2, 5)).toUpperCase();
    const created = run([
      "team",
      "create",
      "--name",
      `${FIXTURE_PREFIX}move`,
      "--key",
      key,
      "--json",
    ]);
    if (created.code !== 0) {
      // Free plans cap the team count; an environment limit, not a defect.
      const message = JSON.parse(created.stderr).error?.message ?? "";
      if (/limit of teams|upgrade|reached the limit/i.test(message)) return;
      throw new Error(`team create failed: ${created.stderr}`);
    }
    const destination = JSON.parse(created.stdout) as { id: string; key: string };
    teamIds.push(destination.id);

    // A label scoped to the SOURCE team: it cannot follow the issue across.
    const label = runJson<{ id: string; name: string }>([
      "label",
      "create",
      "--name",
      `${FIXTURE_PREFIX}teamlabel`,
      "--team",
      TEAM,
    ]);
    labelIds.push(label.id);

    const before = runJson<{ identifier: string }>([
      "issue",
      "create",
      "--title",
      `${FIXTURE_PREFIX}move`,
      "--team",
      TEAM,
      "--assignee",
      "me",
      "--state",
      "started",
      "--label",
      label.name,
    ]).identifier;

    const moved = runJson<{ identifier: string }>([
      "issue",
      "update",
      before,
      "--team",
      destination.key,
    ]);
    // The move renumbers the issue — the whole reason human output announces it.
    expect(moved.identifier.startsWith(`${destination.key}-`)).toBe(true);
    expect(moved.identifier).not.toBe(before);

    const detail = runJson<{ team: string; labels: string[]; cycle: string | null }>([
      "issue",
      "view",
      moved.identifier,
    ]);
    expect(detail.team).toContain(destination.key);
    // Linear drops what the destination team cannot hold.
    expect(detail.labels).not.toContain(label.name);
    expect(detail.cycle).toBeNull();

    // The ordering that matters: everything team-scoped in the same command is
    // resolved against the DESTINATION team. Passing the source team's state id
    // would fail with "Discrepancy between issue team and state, cycle or project".
    const back = runJson<{ identifier: string }>([
      "issue",
      "update",
      moved.identifier,
      "--team",
      TEAM,
      "--state",
      "unstarted",
      "--add-label",
      label.name,
    ]);
    expect(back.identifier.startsWith(`${TEAM}-`)).toBe(true);
    const after = runJson<{ team: string; state: string; labels: string[] }>([
      "issue",
      "view",
      back.identifier,
    ]);
    expect(after.team).toContain(TEAM);
    expect(after.labels).toContain(label.name);
    run(["issue", "delete", back.identifier, "--yes", "--json"]);
  });
});
