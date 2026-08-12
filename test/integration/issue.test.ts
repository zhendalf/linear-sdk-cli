import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { run, runJson, LIVE, ensureBuilt, FIXTURE_PREFIX } from "./_helpers.js";

const suite = LIVE ? describe : describe.skip;
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "TES";

suite("phase 1 — issue lifecycle (live)", () => {
  const created: string[] = [];
  const createdLabels: string[] = [];

  beforeAll(() => ensureBuilt());

  afterAll(() => {
    // Best-effort cleanup; the janitor sweeps anything this misses.
    for (const id of created) run(["issue", "delete", id, "--yes", "--json"]);
    for (const id of createdLabels) run(["label", "delete", id, "--yes", "--json"]);
  });

  /** A fixture label, tracked for cleanup. Returns its id and name. */
  function makeLabel(name: string): { id: string; name: string } {
    const res = runJson<{ id: string; name: string }>([
      "label",
      "create",
      "--name",
      `${FIXTURE_PREFIX}${name}`,
      "--team",
      TEAM,
    ]);
    createdLabels.push(res.id);
    return res;
  }

  function makeIssue(title: string, extra: string[] = []): string {
    const res = runJson<{ identifier: string }>([
      "issue",
      "create",
      "--title",
      `${FIXTURE_PREFIX}${title}`,
      "--team",
      TEAM,
      ...extra,
    ]);
    created.push(res.identifier);
    return res.identifier;
  }

  it("creates an issue and returns identifier + url", () => {
    const res = runJson<{ identifier: string; url: string }>([
      "issue",
      "create",
      "--title",
      `${FIXTURE_PREFIX}create`,
      "--team",
      TEAM,
      "--priority",
      "2",
    ]);
    created.push(res.identifier);
    expect(res.identifier).toMatch(/^[A-Z]+-\d+$/);
    expect(res.url).toContain("linear.app");
  });

  it("views an issue with resolved relations", () => {
    const id = makeIssue("view");
    const d = runJson<{ identifier: string; priorityLabel: string; team: string }>([
      "issue",
      "view",
      id,
    ]);
    expect(d.identifier).toBe(id);
    expect(d.team).toContain(TEAM);
  });

  it("updates title, priority, state and assignee", () => {
    const id = makeIssue("update");
    runJson(["issue", "update", id, "--title", `${FIXTURE_PREFIX}updated`, "--priority", "1"]);
    runJson(["issue", "assign", id, "me"]);
    runJson(["issue", "state", id, "started"]);
    const d = runJson<{ title: string; priority: number; assignee: string | null }>([
      "issue",
      "view",
      id,
    ]);
    expect(d.title).toBe(`${FIXTURE_PREFIX}updated`);
    expect(d.priority).toBe(1);
    expect(d.assignee).toBeTruthy();
  });

  it("adds and lists comments", () => {
    const id = makeIssue("comment");
    runJson(["issue", "comment", id, "hello from the test suite"]);
    const comments = runJson<Array<{ body: string }>>(["issue", "comments", id]);
    expect(comments.some((c) => c.body.includes("hello from the test suite"))).toBe(true);
  });

  it("lists issues filtered by team and assignee", () => {
    const id = makeIssue("list", ["--assignee", "me"]);
    const rows = runJson<Array<{ identifier: string }>>([
      "issue",
      "list",
      "--team",
      TEAM,
      "--assignee",
      "me",
      "--limit",
      "50",
    ]);
    expect(rows.some((r) => r.identifier === id)).toBe(true);
  });

  it("manages blocks/blocked-by relations in both directions", () => {
    const a = makeIssue("rel-a");
    const b = makeIssue("rel-b");
    runJson(["issue", "relation", a, "add", b, "--blocked-by"]);
    const relsA = runJson<Array<{ type: string; issue: string }>>(["issue", "relation", a, "list"]);
    expect(relsA.find((r) => r.issue === b)?.type).toBe("blocked_by");
    const relsB = runJson<Array<{ type: string; issue: string }>>(["issue", "relation", b, "list"]);
    expect(relsB.find((r) => r.issue === a)?.type).toBe("blocks");
    runJson(["issue", "relation", a, "remove", b, "--blocked-by"]);
  });

  it("archives then deletes an issue", () => {
    const id = makeIssue("archive");
    expect(runJson<{ archived: boolean }>(["issue", "archive", id, "--yes"]).archived).toBe(true);
    runJson(["issue", "unarchive", id]);
    const del = runJson<{ deleted: boolean }>(["issue", "delete", id, "--yes"]);
    expect(del.deleted).toBe(true);
    // already deleted; drop from cleanup list
    const idx = created.indexOf(id);
    if (idx >= 0) created.splice(idx, 1);
  });

  it("refuses to delete without --yes in non-interactive mode", () => {
    const id = makeIssue("noyes");
    const res = run(["issue", "delete", id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });

  // `--sort priority` is state-first, then priority — so this only holds for two
  // issues sharing a workflow state. The cross-state half is asserted below.
  it("sorts by priority urgency descending within a state (Urgent before Low)", () => {
    const urgent = makeIssue("p-urgent", ["--priority", "1", "--state", "unstarted"]);
    const low = makeIssue("p-low", ["--priority", "4", "--state", "unstarted"]);
    const rows = runJson<Array<{ identifier: string }>>([
      "issue",
      "list",
      "--team",
      TEAM,
      "--sort",
      "priority",
      "--limit",
      "100",
    ]);
    const iu = rows.findIndex((r) => r.identifier === urgent);
    const il = rows.findIndex((r) => r.identifier === low);
    expect(iu).toBeGreaterThanOrEqual(0);
    expect(il).toBeGreaterThanOrEqual(0);
    expect(iu).toBeLessThan(il);
  });

  // The change in 1.3: workflow state outranks priority, so all of one state's
  // issues precede all of another's regardless of urgency. Previously an Urgent
  // issue sorted above every Low one no matter what state either was in.
  it("groups `--sort priority` by workflow state before priority", () => {
    // Priorities deliberately cross the state boundary: under the old
    // priority-only sort the Urgent started issue outranked the Low unstarted
    // one, interleaving the states. State-first keeps each state contiguous.
    const urgentStarted = makeIssue("s-urgent-started", ["--priority", "1", "--state", "started"]);
    const lowStarted = makeIssue("s-low-started", ["--priority", "4", "--state", "started"]);
    const lowUnstarted = makeIssue("s-low-unstarted", ["--priority", "4", "--state", "unstarted"]);
    const rows = runJson<Array<{ identifier: string; state: { name: string } | null }>>([
      "issue",
      "list",
      "--team",
      TEAM,
      "--sort",
      "priority",
      "--limit",
      "200",
    ]);
    const ids = rows.map((r) => r.identifier);
    for (const id of [urgentStarted, lowStarted, lowUnstarted]) expect(ids).toContain(id);

    // Every state's rows are contiguous — no state reappears after another.
    const seen = new Set<string>();
    let previous: string | undefined;
    for (const row of rows) {
      const state = row.state?.name ?? "";
      if (state === previous) continue;
      expect(seen.has(state)).toBe(false);
      seen.add(state);
      previous = state;
    }
    // …and priority still breaks ties inside a state.
    expect(ids.indexOf(urgentStarted)).toBeLessThan(ids.indexOf(lowStarted));
  });

  // The change in 1.2: repeated --label narrows. It used to broaden, so this
  // query would also have returned the single-labelled issue.
  it("narrows on repeated --label (issue must carry every label)", () => {
    const a = makeLabel("la");
    const b = makeLabel("lb");
    const onlyA = makeIssue("lbl-a", ["--label", a.name]);
    const both = makeIssue("lbl-ab", ["--label", a.name, "--label", b.name]);

    const one = runJson<Array<{ identifier: string }>>(
      ["issue", "list", "--team", TEAM, "--label", a.name, "--limit", "100"],
    ).map((r) => r.identifier);
    expect(one).toContain(onlyA);
    expect(one).toContain(both);

    const two = runJson<Array<{ identifier: string }>>(
      ["issue", "list", "--team", TEAM, "--label", a.name, "--label", b.name, "--limit", "100"],
    ).map((r) => r.identifier);
    expect(two).toContain(both);
    expect(two).not.toContain(onlyA);
  });

  // 1.1: `mine` is the viewer's unstarted work; `--all-states` widens it.
  it("`issue mine` shows your unstarted issues only, until --all-states", () => {
    const id = makeIssue("mine", ["--assignee", "me", "--state", "unstarted"]);
    const ids = (extra: string[] = []) =>
      runJson<Array<{ identifier: string }>>([
        "issue",
        "mine",
        "--team",
        TEAM,
        "--limit",
        "200",
        ...extra,
      ]).map((r) => r.identifier);

    expect(ids()).toContain(id);

    runJson(["issue", "state", id, "started"]);
    expect(ids()).not.toContain(id);
    expect(ids(["--all-states"])).toContain(id);
  });

  it("`issue mine` never shows another assignee's issues", () => {
    const unassigned = makeIssue("mine-unassigned", ["--state", "unstarted"]);
    const ids = runJson<Array<{ identifier: string }>>([
      "issue",
      "mine",
      "--team",
      TEAM,
      "--limit",
      "200",
    ]).map((r) => r.identifier);
    expect(ids).not.toContain(unassigned);
  });

  it("gives a usage error for assign with an id-shaped single arg (missing assignee)", () => {
    const id = makeIssue("assignerr");
    const res = run(["issue", "assign", id, "--json"]);
    expect(res.code).toBe(2);
    expect(JSON.parse(res.stderr).error.code).toBe("usage");
  });
});
