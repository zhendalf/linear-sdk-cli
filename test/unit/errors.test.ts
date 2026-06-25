import { describe, it, expect } from "vitest";
import { normalizeError, CliError, ExitCode, usageError } from "../../src/lib/errors.js";

describe("normalizeError", () => {
  it("passes CliError through unchanged", () => {
    const e = usageError("bad");
    expect(normalizeError(e)).toBe(e);
  });

  it("classifies authentication errors", () => {
    class AuthenticationLinearError extends Error {}
    const e = normalizeError(new AuthenticationLinearError("nope"));
    expect(e.code).toBe("auth");
    expect(e.exitCode).toBe(ExitCode.Auth);
  });

  it("classifies rate-limit errors", () => {
    class RatelimitedLinearError extends Error {}
    const e = normalizeError(new RatelimitedLinearError("slow down"));
    expect(e.code).toBe("rate_limited");
    expect(e.exitCode).toBe(ExitCode.RateLimited);
  });

  it("classifies validation errors and surfaces gql messages", () => {
    class InvalidInputLinearError extends Error {
      errors = [{ message: "title is required" }];
    }
    const e = normalizeError(new InvalidInputLinearError("invalid"));
    expect(e.code).toBe("validation");
    expect(e.message).toBe("title is required");
  });

  it("falls back to runtime for unknown errors", () => {
    expect(normalizeError(new Error("boom")).code).toBe("runtime");
    expect(normalizeError("string error").code).toBe("runtime");
  });
});

describe("CliError", () => {
  it("maps codes to exit codes", () => {
    expect(new CliError("x", "not_found").exitCode).toBe(ExitCode.NotFound);
    expect(new CliError("x", "usage").exitCode).toBe(ExitCode.Usage);
  });
});
