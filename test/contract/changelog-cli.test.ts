import { describe, expect, it, vi } from "bun:test";
import { createProgram } from "../../src/cli.js";

async function run(args: string[]): Promise<string> {
  let stdout = "";
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdout += chunk;
    return true;
  });
  try {
    await createProgram().parseAsync(["node", "linear", ...args]);
  } finally {
    out.mockRestore();
  }
  return stdout;
}

describe("changelog CLI contract", () => {
  it("shows the latest three releases by default without credentials", async () => {
    const releases = JSON.parse(await run(["changelog", "--json"]));
    expect(releases).toHaveLength(3);
    expect(releases[0].version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(releases[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(releases[0].sections[0].items.length).toBeGreaterThan(0);
  });

  it("honors --limit and renders readable Markdown in a pipe", async () => {
    const output = await run(["changelog", "--limit", "1"]);
    expect(output.match(/^## \[/gm)).toHaveLength(1);
    expect(output).toContain("### ");
  });
});
