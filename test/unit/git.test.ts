import { describe, it, expect } from "bun:test";
import { branchToIssueId, buildTrailer, buildPrArgs } from "../../src/git.js";

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

describe("buildTrailer", () => {
  it("defaults to a 'Fixes <ID>' trailer", () => {
    expect(buildTrailer("TES-123")).toBe("Fixes TES-123");
  });

  it("uses 'References <ID>' when references is set", () => {
    expect(buildTrailer("TES-123", { references: true })).toBe("References TES-123");
  });

  it("treats references:false the same as the default", () => {
    expect(buildTrailer("ENG-7", { references: false })).toBe("Fixes ENG-7");
  });
});

describe("buildPrArgs", () => {
  it("always includes pr create with title and body", () => {
    expect(buildPrArgs({ title: "My PR", body: "body text" })).toEqual([
      "pr",
      "create",
      "--title",
      "My PR",
      "--body",
      "body text",
    ]);
  });

  it("includes base and head when set", () => {
    expect(buildPrArgs({ title: "t", body: "b", base: "main", head: "feature" })).toEqual([
      "pr",
      "create",
      "--title",
      "t",
      "--body",
      "b",
      "--base",
      "main",
      "--head",
      "feature",
    ]);
  });

  it("adds --draft only when draft is true", () => {
    expect(buildPrArgs({ title: "t", body: "b", draft: true })).toContain("--draft");
    expect(buildPrArgs({ title: "t", body: "b", draft: false })).not.toContain("--draft");
    expect(buildPrArgs({ title: "t", body: "b" })).not.toContain("--draft");
  });

  it("adds --web only when web is true", () => {
    expect(buildPrArgs({ title: "t", body: "b", web: true })).toContain("--web");
    expect(buildPrArgs({ title: "t", body: "b" })).not.toContain("--web");
  });

  it("omits base/head flags when unset", () => {
    const args = buildPrArgs({ title: "t", body: "b" });
    expect(args).not.toContain("--base");
    expect(args).not.toContain("--head");
  });
});
