import { describe, it, expect } from "bun:test";
import { Command } from "commander";
import { walkCommands } from "../../src/lib/introspect.js";
import { createProgram } from "../../src/cli.js";

describe("walkCommands", () => {
  it("flattens a nested command tree with paths, args, options, aliases", () => {
    const root = new Command();
    const grp = root.command("grp").alias("g").description("a group");
    grp
      .command("do <id> [extra...]")
      .description("do a thing")
      .option("--flag", "a flag");

    const nodes = walkCommands(root);
    const paths = nodes.map((n) => n.path);
    expect(paths).toContain("grp");
    expect(paths).toContain("grp do");

    const sub = nodes.find((n) => n.path === "grp do")!;
    expect(sub.description).toBe("do a thing");
    expect(sub.arguments).toEqual([
      { name: "id", required: true, variadic: false },
      { name: "extra", required: false, variadic: true },
    ]);
    expect(sub.options.some((o) => o.flags === "--flag")).toBe(true);

    const group = nodes.find((n) => n.path === "grp")!;
    expect(group.aliases).toContain("g");
  });

  it("is sorted by path and skips the help command", () => {
    const root = new Command();
    root.command("b").description("b");
    root.command("a").description("a");
    const nodes = walkCommands(root);
    const paths = nodes.map((n) => n.path);
    expect(paths).not.toContain("help");
    expect([...paths].sort()).toEqual(paths);
  });

  it("covers the real program's command tree", () => {
    const nodes = walkCommands(createProgram());
    const paths = nodes.map((n) => n.path);
    expect(paths).toContain("issue create");
    expect(paths).toContain("issue view");
    expect(paths).toContain("commands");
    expect(paths).toContain("schema");
    expect(paths).toContain("api");
  });
});
