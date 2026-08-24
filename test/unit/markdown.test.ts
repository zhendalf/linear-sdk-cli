import { describe, expect, it } from "bun:test";
import { renderMarkdown } from "../../src/output/markdown.js";

describe("renderMarkdown", () => {
  it("renders common Linear body syntax as readable plain terminal text", () => {
    const result = renderMarkdown(
      [
        "# Release notes",
        "",
        "A **bold** choice, *emphasis*, `code`, and [docs](https://example.com).",
        "",
        "- first",
        "- [x] shipped",
        "> quoted",
      ].join("\n"),
    );

    expect(result).toBe(
      [
        "Release notes",
        "",
        "A bold choice, emphasis, code, and docs (https://example.com).",
        "",
        "• first",
        "☑ shipped",
        "│ quoted",
      ].join("\n"),
    );
  });

  it("renders fenced code without interpreting Markdown inside it", () => {
    expect(renderMarkdown("```ts\nconst x = '**literal**';\n```")).toBe(
      "    const x = '**literal**';",
    );
  });

  it("adds only renderer-owned SGR when color is enabled", () => {
    const escape = String.fromCharCode(27);
    const result = renderMarkdown("# Title\nA **bold** word and `code`.", { color: true });
    expect(result).toContain(`${escape}[`);
    expect(result).toContain("Title");
    expect(result).toContain("bold");
  });

  it("removes API-controlled escapes and carriage-return overwrite bytes first", () => {
    const escape = String.fromCharCode(27);
    const input = `# safe ${escape}]0;owned${escape}\\title\rOVERWRITE`;
    const result = renderMarkdown(input, { color: false });
    expect(result).toBe("safe titleOVERWRITE");
    expect(result).not.toContain(escape);
    expect(result).not.toContain("owned");
  });
});
