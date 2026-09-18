import { describe, expect, it } from "bun:test";
import { parseChangelog } from "../../src/commands/changelog.js";

describe("changelog", () => {
  it("parses releases, sections, and wrapped list items", () => {
    const markdown = `# Changelog

Introductory text.

## [2.0.0](https://example.com/v2) (2026-09-18)

### Features

- add a command
  with a wrapped detail

### Bug Fixes

- fix the thing

## [1.0.0](https://example.com/v1) (2026-09-01)

### Features

- initial release
`;

    expect(parseChangelog(markdown)).toEqual([
      {
        version: "2.0.0",
        date: "2026-09-18",
        url: "https://example.com/v2",
        sections: [
          { title: "Features", items: ["add a command with a wrapped detail"] },
          { title: "Bug Fixes", items: ["fix the thing"] },
        ],
      },
      {
        version: "1.0.0",
        date: "2026-09-01",
        url: "https://example.com/v1",
        sections: [{ title: "Features", items: ["initial release"] }],
      },
    ]);
  });
});
