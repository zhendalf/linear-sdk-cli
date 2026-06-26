import { describe, it, expect, vi, afterEach } from "bun:test";
import { CommanderError } from "commander";
import { createProgram } from "../../src/cli.js";

// Commander writes help/version to stdout; silence it during these tests.
afterEach(() => vi.restoreAllMocks());
function silenceStdout() {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
}

describe("commander error boundary", () => {
  it("throws CommanderError on an unknown option (not process.exit)", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(["node", "linear", "whoami", "--definitely-not-a-flag"]),
    ).rejects.toBeInstanceOf(CommanderError);
  });

  it("throws CommanderError on a missing required argument", async () => {
    const program = createProgram();
    await expect(program.parseAsync(["node", "linear", "completion"])).rejects.toBeInstanceOf(
      CommanderError,
    );
  });

  it("treats --version as a zero-exit CommanderError", async () => {
    silenceStdout();
    const program = createProgram();
    try {
      await program.parseAsync(["node", "linear", "--version"]);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CommanderError);
      expect((err as CommanderError).exitCode).toBe(0);
    }
  });

  it("exposes global --json on a leaf command", () => {
    const program = createProgram();
    const help = program.commands.find((c) => c.name() === "config")?.helpInformation() ?? "";
    expect(help).toContain("--json");
  });
});
