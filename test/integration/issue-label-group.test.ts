import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ensureBuilt, FIXTURE_PREFIX, LIVE, run, runJson } from "./_helpers.js";

const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "LIN";
const GROUP = process.env.LINEAR_CLI_TEST_LABEL_GROUP;
const MEMBER = process.env.LINEAR_CLI_TEST_LABEL_GROUP_MEMBER;
const suite = LIVE && GROUP && MEMBER ? describe : describe.skip;

suite("issue label --set-group (live, pre-existing group fixture)", () => {
  const created: string[] = [];

  beforeAll(() => ensureBuilt());

  afterAll(() => {
    for (const id of created) run(["issue", "delete", id, "--yes", "--json"]);
  });

  function makeIssue(): string {
    const result = runJson<{ identifier: string }>([
      "issue",
      "create",
      "--title",
      `${FIXTURE_PREFIX}set-group`,
      "--team",
      TEAM,
    ]);
    created.push(result.identifier);
    return result.identifier;
  }

  it("previews, writes once, reads back, then returns an explicit no-op", () => {
    const issue = makeIssue();
    const assignment = `${GROUP}=${MEMBER}`;
    const preview = runJson<{
      changed: boolean;
      mutationSent: boolean;
      input: { addedLabelIds: string[]; removedLabelIds: string[] };
    }>(["issue", "label", issue, "--set-group", assignment, "--dry-run"]);
    expect(preview.changed).toBe(true);
    expect(preview.mutationSent).toBe(false);
    expect(preview.input.addedLabelIds).toHaveLength(1);

    const changed = runJson<{
      receipt: { changed: boolean; mutationSent: boolean; groups: unknown[] };
      verified: boolean;
    }>(["issue", "label", issue, "--set-group", assignment, "--full-result"]);
    expect(changed.receipt).toMatchObject({ changed: true, mutationSent: true });
    expect(changed.receipt.groups).toHaveLength(1);
    expect(changed.verified).toBe(true);

    const noOp = runJson<{ changed: boolean; mutationSent: boolean }>([
      "issue",
      "label",
      issue,
      "--set-group",
      assignment,
    ]);
    expect(noOp).toMatchObject({ changed: false, mutationSent: false });
  });
});
