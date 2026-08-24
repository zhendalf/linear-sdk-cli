import { describe, it, expect } from "bun:test";
import {
  branchToIssueId,
  buildTrailer,
  buildTrailers,
  buildDescription,
  buildPrContent,
  buildPrArgs,
} from "../../src/git.js";

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

/**
 * TES-637 (5). `issue describe` is piped into `git commit -m` / `jj describe
 * -m`; schpet/linear-cli prints `ID Title`, a blank line, then two git
 * trailers (T `src/utils/jj.ts:11-18`). Ours printed `Title` and a bare `Fixes
 * ID` line, so the same pipeline made a different commit. Same shape now, byte
 * for byte — and proper trailers are what `git interpret-trailers` and jj's
 * `trailers` template read back.
 */
describe("buildTrailers / buildDescription — schpet's commit message, byte for byte", () => {
  const URL = "https://linear.app/acme/issue/TES-123/fix-login";

  it("two trailers: Linear-issue with the magic word, Linear-issue-url with the url", () => {
    expect(buildTrailers("TES-123", URL)).toBe(
      `Linear-issue: Fixes TES-123\nLinear-issue-url: ${URL}`,
    );
  });

  it("--references swaps the magic word and nothing else", () => {
    expect(buildTrailers("TES-123", URL, { references: true })).toBe(
      `Linear-issue: References TES-123\nLinear-issue-url: ${URL}`,
    );
  });

  it("the message is `ID Title`, a blank line, the trailers — schpet's formatIssueDescription", () => {
    // T: `${issueId} ${title}\n\nLinear-issue: ${magicWord} ${issueId}\nLinear-issue-url: ${url}`
    expect(buildDescription("TES-123", "Fix login", URL)).toBe(
      `TES-123 Fix login\n\nLinear-issue: Fixes TES-123\nLinear-issue-url: ${URL}`,
    );
    expect(buildDescription("TES-123", "Fix login", URL, { references: true })).toBe(
      `TES-123 Fix login\n\nLinear-issue: References TES-123\nLinear-issue-url: ${URL}`,
    );
  });

  it("the magic word sits directly before the id, which is where Linear reads it", () => {
    for (const line of buildDescription("TES-123", "t", URL).split("\n")) {
      if (line.startsWith("Linear-issue:")) expect(line).toMatch(/\bFixes TES-123$/);
    }
  });
});

/**
 * TES-637 (5). `issue pull-request`: schpet titles the PR `ID Title` (a custom
 * `--title` gets the same prefix) and sends the issue URL as the body
 * (T `issue-pull-request.ts:45-57`). Ours titled it `Title` and pasted the
 * issue's description into the body. Title matches now; the body is the two
 * trailers — the URL as there, plus the magic word so the link does not depend
 * on the branch name — and the description stays in Linear.
 */
describe("buildPrContent", () => {
  const issue = {
    identifier: "TES-123",
    title: "Fix login",
    url: "https://linear.app/acme/issue/TES-123/x",
  };

  it("titles the PR `ID Title`", () => {
    expect(buildPrContent(issue).title).toBe("TES-123 Fix login");
  });

  it("prefixes a custom title with the id too, as schpet does", () => {
    expect(buildPrContent(issue, "Login fix, take 2").title).toBe("TES-123 Login fix, take 2");
  });

  it("the body is the trailers — the url, and the closing magic word — never the issue description", () => {
    const { body } = buildPrContent({ ...issue, description: "internal notes" } as any);
    expect(body).toBe(`Linear-issue: Fixes TES-123\nLinear-issue-url: ${issue.url}`);
    expect(body).not.toContain("internal notes");
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
