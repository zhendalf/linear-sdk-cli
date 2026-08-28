import { describe, it, expect, mock, beforeEach, afterEach, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { Context } from "../../src/context.js";
import { CliError } from "../../src/lib/errors.js";

/**
 * Record which @inquirer/prompts prompt was used and with what configuration.
 *
 * The mock returns what the real prompts return — `password`/`input` resolve
 * with a string, `confirm` with a boolean — because the point of these tests is
 * *which library function runs*, and a mock that answered in a shape inquirer
 * never produces would prove nothing about the real thing.
 */
const calls: Array<{ prompt: string; config: any }> = [];
let confirmAnswer = false;

mock.module("@inquirer/prompts", () => ({
  confirm: async (config: any) => {
    calls.push({ prompt: "confirm", config });
    return confirmAnswer;
  },
  input: async (config: any) => {
    calls.push({ prompt: "input", config });
    return "typed value";
  },
  password: async (config: any) => {
    calls.push({ prompt: "password", config });
    return "lin_api_TESTSECRET";
  },
  select: async (config: any) => {
    calls.push({ prompt: "select", config });
    return config.choices[0].value;
  },
}));

const { confirmDestructive, promptSecret, promptInput, EXIT_CANCELLED } =
  await import("../../src/lib/prompt.js");

/**
 * A Context that really is interactive. Built by making the process look like a
 * TTY and letting `Context` compute `isTTY` itself, rather than by poking the
 * field — the computation is half of what these tests are checking.
 */
function interactiveContext(options: Record<string, unknown> = {}): Context {
  (process.stdin as any).isTTY = true;
  (process.stdout as any).isTTY = true;
  return new Context(options as any);
}

let stdinTTY: unknown;
let stdoutTTY: unknown;

beforeEach(() => {
  calls.length = 0;
  confirmAnswer = false;
  stdinTTY = (process.stdin as any).isTTY;
  stdoutTTY = (process.stdout as any).isTTY;
  // Bun does not accept `undefined` here, so 0 ("nothing has gone wrong yet")
  // is the baseline these tests treat as untouched.
  process.exitCode = 0;
});

afterEach(() => {
  (process.stdin as any).isTTY = stdinTTY;
  (process.stdout as any).isTTY = stdoutTTY;
  process.exitCode = 0;
  vi.restoreAllMocks();
});

/** Capture everything written to stdout/stderr while `fn` runs. */
async function captureStreams(fn: () => Promise<unknown>): Promise<{ out: string; err: string }> {
  let out = "";
  let err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => ((out += c), true));
  const e = vi.spyOn(process.stderr, "write").mockImplementation((c: any) => ((err += c), true));
  try {
    await fn();
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
  return { out, err };
}

/**
 * `auth login` once echoed the API key. The assertion is against the
 * library: inquirer's `password` prompt is what does not render the value, so
 * "masked" means "that function ran", not "our wrapper is named nicely".
 */
describe("promptSecret", () => {
  it("uses inquirer's password prompt — not input, which echoes", async () => {
    const ctx = interactiveContext();
    await promptSecret(ctx, "Linear API key:", { required: true });
    expect(calls.map((c) => c.prompt)).toEqual(["password"]);
    expect(calls[0]!.config.message).toBe("Linear API key:");
    expect(calls[0]!.config.mask).toBe(true);
  });

  it("disables the mask-toggle so the secret can't be revealed on screen", async () => {
    const ctx = interactiveContext();
    await promptSecret(ctx, "Linear API key:", { required: true });
    expect(calls[0]!.config.toggleMask).toBe(false);
  });

  it("returns the secret without printing it to either stream", async () => {
    const ctx = interactiveContext();
    let secret = "";
    const { out, err } = await captureStreams(async () => {
      secret = await promptSecret(ctx, "Linear API key:", { required: true });
    });
    expect(secret).toBe("lin_api_TESTSECRET");
    expect(out).toBe("");
    expect(err).toBe("");
  });

  it("rejects empty input when required, like promptInput does", async () => {
    const ctx = interactiveContext();
    await promptSecret(ctx, "Linear API key:", { required: true });
    expect(calls[0]!.config.validate("   ")).toBe("Required");
    expect(calls[0]!.config.validate("lin_api_x")).toBe(true);
  });

  it("refuses rather than hangs when there is nobody to prompt", async () => {
    await expect(
      promptSecret(new Context({ noInput: true } as any), "Key:"),
    ).rejects.toBeInstanceOf(CliError);
  });

  it("promptInput still uses the echoing prompt — it is for non-secrets", async () => {
    await promptInput(interactiveContext(), "Name:");
    expect(calls.map((c) => c.prompt)).toEqual(["input"]);
  });
});

/** Browser OAuth is the interactive default; personal keys are accepted only through an explicit
 * option, with stdin remaining the secret-safe compatibility path. */
describe("auth login keeps personal API keys explicit", () => {
  const source = readFileSync(new URL("../../src/commands/meta.ts", import.meta.url), "utf8");
  const loginSource = source.slice(source.indexOf("// login"), source.indexOf("// adopt"));

  it("defaults to browser OAuth and retains --key -", () => {
    expect(source).toContain('.option("--no-browser"');
    expect(source).toContain('if (key === "-") key = readStdinSync()');
  });

  it("does not prompt for or echo an API key from the browser-login path", () => {
    expect(source).not.toContain('promptSecret(ctx, "Linear API key:"');
  });

  it("never writes the key to output — the receipt names the user and the path", () => {
    // `auth token` is the one command whose job is to print the secret; login is not it.
    expect(loginSource).not.toMatch(/success\([^)]*\bkey\b[^)]*\)/);
  });
});

/**
 * A declined confirmation used to return before any output call: exit 0 and an
 * empty stdout, which is exactly what a successful delete looks like.
 */
describe("confirmDestructive decline (cancellation receipt)", () => {
  it("returns false, emits a JSON receipt, and sets a non-zero exit code", async () => {
    confirmAnswer = false;
    const ctx = interactiveContext({ json: true });
    // `--json` makes Context non-interactive by design, so drive the prompt path
    // directly with an Output that is in json mode.
    (ctx as any).isTTY = true;
    let answer: boolean | undefined;
    const { out } = await captureStreams(async () => {
      answer = await confirmDestructive(ctx, "Delete label bug?");
    });
    expect(answer).toBe(false);
    expect(JSON.parse(out)).toEqual({ cancelled: true, action: "Delete label bug?" });
    expect(process.exitCode).toBe(EXIT_CANCELLED);
  });

  it("uses an exit code distinct from success and from every failure code", () => {
    // 0 ok · 1 runtime · 2 usage · 3 not-found · 4 auth · 5 rate-limited.
    expect(EXIT_CANCELLED).toBe(6);
    expect([0, 1, 2, 3, 4, 5]).not.toContain(EXIT_CANCELLED);
  });

  it("human mode notes the cancellation on stderr and leaves stdout clean", async () => {
    confirmAnswer = false;
    const ctx = interactiveContext();
    const { out, err } = await captureStreams(async () => {
      await confirmDestructive(ctx, "Delete label bug?");
    });
    expect(out).toBe("");
    expect(err).toContain("Cancelled: Delete label bug?");
    expect(process.exitCode).toBe(EXIT_CANCELLED);
  });

  it("accepting changes nothing: true, no receipt, exit code untouched", async () => {
    confirmAnswer = true;
    const ctx = interactiveContext();
    const { out, err } = await captureStreams(async () => {
      expect(await confirmDestructive(ctx, "Delete label bug?")).toBe(true);
    });
    expect(out).toBe("");
    expect(err).toBe("");
    expect(process.exitCode).toBe(0);
  });

  it("--yes skips the prompt entirely", async () => {
    const ctx = interactiveContext({ yes: true });
    expect(await confirmDestructive(ctx, "Delete label bug?")).toBe(true);
    expect(calls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("non-interactive still refuses outright rather than emitting a receipt", async () => {
    // Not the same case: nobody declined, the command simply cannot be asked.
    // That is a usage error, and it must keep its own exit code.
    const ctx = new Context({ noInput: true } as any);
    await expect(confirmDestructive(ctx, "Delete label bug?")).rejects.toThrow(/pass --yes/);
    expect(process.exitCode).toBe(0);
  });
});
