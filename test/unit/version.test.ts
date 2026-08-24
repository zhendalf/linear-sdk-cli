import { describe, expect, it } from "bun:test";
import packageJson from "../../package.json" with { type: "json" };
import { VERSION } from "../../src/cli.js";

describe("CLI version", () => {
  it("comes from package.json so releases cannot drift", () => {
    expect(VERSION).toBe(packageJson.version);
  });
});
