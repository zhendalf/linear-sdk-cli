import { describe, it, expect } from "vitest";
import { branchToIssueId } from "../../src/git.js";

describe("branchToIssueId", () => {
  it("parses a plain linear branch", () => {
    expect(branchToIssueId("tes-123-add-feature")).toBe("TES-123");
  });

  it("parses a username-prefixed branch", () => {
    expect(branchToIssueId("evgenij/tes-7-fix-bug")).toBe("TES-7");
  });

  it("parses a feature/ prefixed branch", () => {
    expect(branchToIssueId("feature/eng-4521-thing")).toBe("ENG-4521");
  });

  it("uppercases the team key", () => {
    expect(branchToIssueId("abc-1")).toBe("ABC-1");
  });

  it("handles multi-letter team keys", () => {
    expect(branchToIssueId("backend-99-x")).toBe("BACKEND-99");
  });

  it("returns undefined for branches without an id", () => {
    expect(branchToIssueId("main")).toBeUndefined();
    expect(branchToIssueId("develop")).toBeUndefined();
    expect(branchToIssueId("release-candidate")).toBeUndefined();
  });

  it("returns undefined for empty/nullish input", () => {
    expect(branchToIssueId("")).toBeUndefined();
    expect(branchToIssueId(undefined)).toBeUndefined();
    expect(branchToIssueId(null)).toBeUndefined();
  });

  it("does not match a bare number", () => {
    expect(branchToIssueId("123")).toBeUndefined();
  });
});
