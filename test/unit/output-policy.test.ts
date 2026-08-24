import { describe, expect, it } from "bun:test";
import { isDebugEnabled, shouldUseColor } from "../../src/output/color.js";

describe("terminal environment policy", () => {
  it("uses color for a TTY and not for an ordinary pipe", () => {
    expect(shouldUseColor({ isTTY: true, env: {} })).toBe(true);
    expect(shouldUseColor({ isTTY: false, env: {} })).toBe(false);
  });

  it("honors NO_COLOR, including when a force variable is also present", () => {
    expect(shouldUseColor({ isTTY: true, env: { NO_COLOR: "1" } })).toBe(false);
    expect(shouldUseColor({ isTTY: false, env: { NO_COLOR: "1", FORCE_COLOR: "1" } })).toBe(false);
  });

  it("honors FORCE_COLOR and CLICOLOR_FORCE for redirected output", () => {
    expect(shouldUseColor({ isTTY: false, env: { FORCE_COLOR: "1" } })).toBe(true);
    expect(shouldUseColor({ isTTY: false, env: { CLICOLOR_FORCE: "1" } })).toBe(true);
    expect(shouldUseColor({ isTTY: true, env: { FORCE_COLOR: "0" } })).toBe(false);
  });

  it("never colors JSON, and an explicit CLI opt-out wins", () => {
    const env = { FORCE_COLOR: "1", CLICOLOR_FORCE: "1" };
    expect(shouldUseColor({ json: true, isTTY: true, env })).toBe(false);
    expect(shouldUseColor({ disabled: true, isTTY: true, env })).toBe(false);
  });

  it("enables debug with --debug, LINEAR_DEBUG=1, or LINEAR_DEBUG=true", () => {
    expect(isDebugEnabled(true, {})).toBe(true);
    expect(isDebugEnabled(false, { LINEAR_DEBUG: "1" })).toBe(true);
    expect(isDebugEnabled(false, { LINEAR_DEBUG: "true" })).toBe(true);
    expect(isDebugEnabled(false, { LINEAR_DEBUG: "0" })).toBe(false);
  });
});
