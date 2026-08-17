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

/**
 * TES-610: every node that prints JSON says what — the `output` shape from
 * `lib/output-shapes.ts` — so an agent knows a row has `.state.name` before it
 * runs anything. Groups that only hold subcommands carry no `output` at all.
 */
describe("walkCommands — output shapes", () => {
  const nodes = walkCommands(createProgram());
  const at = (path: string) => nodes.find((n) => n.path === path)!;

  it("attaches the declared --json shape to a list command", () => {
    const list = at("issue list");
    expect(list.output?.kind).toBe("list");
    expect(list.output?.fields?.state).toEqual({ nullable: { name: "string", type: "string" } });
    expect(list.output?.fields?.milestone).toEqual({ nullable: { id: "string", name: "string" } });
  });

  it("a view is an object with the detail's fields; a mutation is a receipt", () => {
    expect(at("issue view").output?.kind).toBe("object");
    expect(at("issue view").output?.fields?.team).toEqual({
      nullable: { id: "string", key: "string", name: "string" },
    });
    expect(at("comment reply").output).toEqual({
      kind: "receipt",
      fields: { id: "string", parent: "string", issue: "string|null", url: "string" },
    });
  });

  it("raw pass-through and no-JSON commands say so; a bare group has no output", () => {
    expect(at("api").output?.kind).toBe("raw");
    expect(at("completion").output?.kind).toBe("none");
    expect("output" in at("cycle")).toBe(false);
    // A group with a default subcommand prints that subcommand's shape.
    expect(at("issue").output?.kind).toBe("object");
    expect(at("issue").output?.note).toContain("runs `issue view` by default");
  });

  it("a synthetic tree (no registry entry) simply has no output", () => {
    const root = new Command();
    root.command("grp").command("do");
    expect(walkCommands(root).every((n) => !("output" in n))).toBe(true);
  });
});
