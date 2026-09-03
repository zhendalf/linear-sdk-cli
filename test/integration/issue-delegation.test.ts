import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ensureBuilt, FIXTURE_PREFIX, LIVE, run, runJson } from "./_helpers.js";

const AGENT_ID = process.env.LINEAR_CLI_LIVE_AGENT_ID;
const LIVE_AGENT_ID = AGENT_ID ?? "";
const TEAM = process.env.LINEAR_CLI_TEST_TEAM || "LIN";
// Delegation can start an external Agent Session. Require the operator to name
// the exact disposable-test agent instead of selecting one implicitly.
const suite = LIVE && AGENT_ID ? describe : describe.skip;

suite("issue delegation (live, explicitly agent-gated)", () => {
  let created: string | undefined;

  beforeAll(() => ensureBuilt());

  afterAll(() => {
    if (created) run(["issue", "delegate", created, "--clear", "--json"]);
    if (created) run(["issue", "delete", created, "--yes", "--json"]);
  });

  it("previews create, then creates with and clears an authoritative delegate", () => {
    const preview = runJson<{
      operation: string;
      dryRun: boolean;
      target: null;
      input: { delegateId: string };
    }>([
      "issue",
      "create",
      "--title",
      `${FIXTURE_PREFIX}delegation-preview`,
      "--team",
      TEAM,
      "--delegate",
      LIVE_AGENT_ID,
      "--dry-run",
    ]);
    expect(preview).toMatchObject({
      operation: "issue.create",
      dryRun: true,
      target: null,
      input: { delegateId: LIVE_AGENT_ID },
    });

    const full = runJson<{
      receipt: { identifier: string; assignee: { id: string } | null; delegate: { id: string } };
      resource: { delegate: { id: string } };
      verified: boolean;
    }>([
      "issue",
      "create",
      "--title",
      `${FIXTURE_PREFIX}delegation-live`,
      "--team",
      TEAM,
      "--assignee",
      "me",
      "--delegate",
      LIVE_AGENT_ID,
      "--full-result",
    ]);
    created = full.receipt.identifier;
    expect(full.verified).toBe(true);
    expect(full.receipt.assignee).not.toBeNull();
    expect(full.receipt.delegate.id).toBe(LIVE_AGENT_ID);
    expect(full.resource.delegate.id).toBe(LIVE_AGENT_ID);

    const clearedByUpdate = runJson<{
      receipt: { delegate: null };
      resource: { delegate: null };
      verified: boolean;
    }>(["issue", "update", created, "--clear-delegate", "--full-result"]);
    expect(clearedByUpdate.verified).toBe(true);
    expect(clearedByUpdate.receipt.delegate).toBeNull();
    expect(clearedByUpdate.resource.delegate).toBeNull();

    const restoredByUpdate = runJson<{
      receipt: { delegate: { id: string } };
      resource: { delegate: { id: string } };
      verified: boolean;
    }>(["issue", "update", created, "--delegate", LIVE_AGENT_ID, "--full-result"]);
    expect(restoredByUpdate.verified).toBe(true);
    expect(restoredByUpdate.receipt.delegate.id).toBe(LIVE_AGENT_ID);

    const clearedByFocusedCommand = runJson<{
      receipt: { delegate: null };
      resource: { delegate: null };
      verified: boolean;
    }>(["issue", "delegate", created, "--clear", "--full-result"]);
    expect(clearedByFocusedCommand.verified).toBe(true);
    expect(clearedByFocusedCommand.receipt.delegate).toBeNull();
    expect(clearedByFocusedCommand.resource.delegate).toBeNull();
  });
});
