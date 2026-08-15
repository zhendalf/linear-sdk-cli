import { describe, it, expect } from "bun:test";
import { assertMutation, unwrapMutation } from "../../src/lib/mutation.js";
import { CliError } from "../../src/lib/errors.js";
import { payload, okPayload, failedPayload } from "./_fakes.js";

describe("assertMutation", () => {
  it("passes a payload the API confirmed", async () => {
    const p = await assertMutation(okPayload(), "Thing deletion");
    expect(p.success).toBe(true);
  });

  it("rejects success: false", async () => {
    await expect(assertMutation(failedPayload(), "Thing deletion")).rejects.toBeInstanceOf(CliError);
  });

  // Exit 1 (the write did not happen), not exit 2 (you called it wrong): the
  // caller typed a valid command and the API refused it.
  it("classifies a refused mutation as an api failure, exit 1", async () => {
    await expect(assertMutation(failedPayload(), "Thing deletion")).rejects.toMatchObject({
      code: "api",
      exitCode: 1,
    });
  });

  it("names the action in the message so the receipt is not generic", async () => {
    await expect(assertMutation(failedPayload(), "Notification archive")).rejects.toThrow(
      /Notification archive failed/,
    );
  });

  // `success` is `Boolean!` in every Linear payload. A payload without one is a
  // mock that drifted from the SDK, and it must not read as a success.
  it("treats a missing success field as a failure, not a pass", async () => {
    await expect(assertMutation({} as any, "Thing update")).rejects.toBeInstanceOf(CliError);
    await expect(assertMutation({ success: undefined } as any, "Thing update")).rejects.toThrow();
  });

  it("accepts the payload as a promise, so callers can pass the request through", async () => {
    const p = await assertMutation(Promise.resolve(okPayload()), "Thing deletion");
    expect(p.success).toBe(true);
  });
});

describe("unwrapMutation", () => {
  it("awaits and returns the entity the payload carries", async () => {
    const issue = { id: "i1", identifier: "TES-1" };
    expect(await unwrapMutation(payload("issue", issue), "issue", "Issue update")).toBe(issue);
  });

  // The audit's headline case: `{success:false, issue:null}` used to fall back
  // to the pre-mutation issue, printing "Updated TES-1" for a write that never
  // landed. There is no fallback to reach any more.
  it("rejects success: false before it ever looks at the entity", async () => {
    await expect(
      unwrapMutation(failedPayload("issue"), "issue", "Issue update"),
    ).rejects.toMatchObject({ code: "api", exitCode: 1 });
  });

  // A successful payload with no entity is still a failure: we would have
  // nothing truthful to print.
  it("rejects a successful payload that carries no entity", async () => {
    await expect(
      unwrapMutation({ success: true, issue: Promise.resolve(null) } as any, "issue", "Issue update"),
    ).rejects.toThrow(/returned no issue/);
  });

  it("rejects an absent entity key the same way as a null one", async () => {
    await expect(
      unwrapMutation({ success: true } as any, "issue", "Issue update"),
    ).rejects.toMatchObject({ code: "api" });
  });
});
