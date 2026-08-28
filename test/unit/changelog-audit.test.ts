import { describe, expect, it } from "bun:test";
import { auditChangelog } from "../../scripts/changelog-audit";
import { validatePullRequestTitle } from "../../scripts/pr-title-audit";

const valid = `# Changelog

## [1.1.0](https://github.com/example/project/compare/v1.0.0...v1.1.0) (2026-08-28)

### Features

- add a feature ([abc1234](https://github.com/example/project/commit/abc1234))

## [1.0.0](https://github.com/example/project/releases/tag/v1.0.0) (2026-08-20)
`;

describe("changelog audit", () => {
  it("accepts aligned, descending release history and published tags", () => {
    expect(auditChangelog(valid, "1.1.0", { tags: ["v1.0.0", "v1.1.0"] })).toEqual([]);
  });

  it("rejects Unreleased drift, package mismatch, and missing tag sections", () => {
    const errors = auditChangelog(`${valid}\n## [Unreleased]\n`, "1.2.0", {
      tags: ["v1.0.0", "v1.1.0", "v1.2.0"],
    });
    expect(errors).toContain(
      "CHANGELOG.md contains an Unreleased section; Release Please is the sole writer",
    );
    expect(errors).toContain("first changelog version 1.1.0 does not match package.json 1.2.0");
    expect(errors).toContain("published tag v1.2.0 has no CHANGELOG.md section");
  });

  it("rejects broken compare chains and release-tag mismatches", () => {
    const broken = valid.replace("v1.0.0...v1.1.0", "v0.9.0...v1.1.0");
    const errors = auditChangelog(broken, "1.1.0", { releaseTag: "v1.0.0" });
    expect(errors.some((error) => error.includes("compare link must end"))).toBe(true);
    expect(errors).toContain("release tag v1.0.0 does not match package.json version 1.1.0");
  });

  it("rejects duplicate generated entries after release metadata is removed", () => {
    const duplicate = valid.replace(
      "- add a feature ([abc1234](https://github.com/example/project/commit/abc1234))",
      `- add a feature (TES-1) ([abc1234](https://github.com/example/project/commit/abc1234))
- add a feature ([def5678](https://github.com/example/project/commit/def5678))`,
    );
    expect(
      auditChangelog(duplicate, "1.1.0").some((error) =>
        error.includes("duplicate generated entries"),
      ),
    ).toBe(true);
  });
});

describe("pull request title audit", () => {
  it("accepts conventional squash titles", () => {
    expect(validatePullRequestTitle("feat(auth): add browser login")).toBeUndefined();
    expect(validatePullRequestTitle("fix!: remove deprecated output")).toBeUndefined();
    expect(validatePullRequestTitle("chore(main): release 1.2.0")).toBeUndefined();
  });

  it("rejects merge and free-form titles", () => {
    expect(validatePullRequestTitle("Merge pull request #31")).toBeDefined();
    expect(validatePullRequestTitle("Add browser login")).toBeDefined();
  });
});
