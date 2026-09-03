import { describe, expect, it } from "bun:test";
import { lifecycleSuffix } from "../../src/output/lifecycle.js";

describe("lifecycleSuffix", () => {
  it("distinguishes live, archived, and trashed resources", () => {
    expect(lifecycleSuffix({ archivedAt: null, trashed: false })).toBe("");
    expect(lifecycleSuffix({ archivedAt: "2026-01-01T00:00:00.000Z", trashed: false })).toBe(
      " (archived)",
    );
    expect(lifecycleSuffix({ archivedAt: "2026-01-01T00:00:00.000Z", trashed: true })).toBe(
      " (trashed)",
    );
  });
});
