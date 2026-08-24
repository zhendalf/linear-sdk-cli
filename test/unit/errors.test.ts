import { describe, it, expect } from "bun:test";
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

  it("prefers Linear's userPresentableMessage without weakening classification", () => {
    class InvalidInputLinearError extends Error {
      errors = [
        {
          message: "Could not find referenced WorkflowState.",
          extensions: {
            type: "InvalidInput",
            userPresentableMessage: "That workflow state is no longer available.",
          },
        },
      ];
    }
    const e = normalizeError(new InvalidInputLinearError("invalid"));
    expect(e.message).toBe("That workflow state is no longer available.");
    // The raw GraphQL message still participates in the established not-found
    // reclassification even though it is no longer the displayed message.
    expect(e.code).toBe("not_found");
    expect(e.exitCode).toBe(ExitCode.NotFound);
  });

  it("extracts GraphQL errors from a direct response as well as SDK wrappers", () => {
    class GraphQLClientError extends Error {
      response = {
        errors: [
          {
            message: "Internal wording",
            extensions: { userPresentableMessage: "Readable wording" },
          },
        ],
      };
    }
    expect(normalizeError(new GraphQLClientError("fallback")).message).toBe("Readable wording");
  });

  it("does not let an empty SDK errors array hide raw GraphQL response errors", () => {
    class InvalidInputLinearError extends Error {
      errors: unknown[] = [];
      raw = {
        response: {
          errors: [
            {
              message: "Internal wording",
              extensions: { userPresentableMessage: "Raw response wording" },
            },
          ],
        },
      };
    }
    expect(normalizeError(new InvalidInputLinearError("fallback")).message).toBe(
      "Raw response wording",
    );
  });

  it("falls back to runtime for unknown errors", () => {
    expect(normalizeError(new Error("boom")).code).toBe("runtime");
    expect(normalizeError("string error").code).toBe("runtime");
  });

  it("reclassifies 'could not find referenced X' validation errors as not_found", () => {
    class InvalidInputLinearError extends Error {
      errors = [{ message: "Could not find referenced WorkflowState." }];
    }
    const e = normalizeError(new InvalidInputLinearError("invalid"));
    expect(e.code).toBe("not_found");
    expect(e.exitCode).toBe(ExitCode.NotFound);
  });
});

/**
 * What the SDK actually throws when the connection is refused (verified live
 * against a dead proxy): `UnknownLinearError`, `type: "Unknown"`, no `status`,
 * and the socket error under `raw` with `code: "ConnectionRefused"`. Before
 * TES-630 that classified as `api` — README promises `network`.
 */
describe("normalizeError — transport failures", () => {
  class UnknownLinearError extends Error {
    type = "Unknown";
    status: number | undefined = undefined;
    errors: unknown[] = [];
    raw: any;
    constructor(raw: any) {
      super(raw?.message ?? "Unable to connect. Is the computer able to access the url?");
      this.raw = raw;
    }
  }

  it("classifies bun's ConnectionRefused as network, exit 1", () => {
    const e = normalizeError(
      new UnknownLinearError({ code: "ConnectionRefused", name: "Error", path: "", errno: 0 }),
    );
    expect(e.code).toBe("network");
    expect(e.exitCode).toBe(ExitCode.Runtime);
    expect(e.message).toMatch(/Unable to connect/);
  });

  it("classifies node's errno codes (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, EAI_AGAIN) as network", () => {
    for (const code of ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"]) {
      expect(normalizeError(new UnknownLinearError({ code, name: "Error" })).code).toBe("network");
    }
  });

  it("finds the errno under `cause` (undici's `TypeError: fetch failed`)", () => {
    const fetchFailed = new TypeError("fetch failed");
    (fetchFailed as any).cause = { code: "ECONNREFUSED", name: "Error" };
    expect(normalizeError(new UnknownLinearError(fetchFailed)).code).toBe("network");
    // ...and an unwrapped fetch TypeError, should one ever escape the SDK.
    expect(normalizeError(fetchFailed).code).toBe("network");
  });

  it("surfaces {name, code, status} from raw as detail for --debug", () => {
    const e = normalizeError(
      new UnknownLinearError({ code: "ConnectionRefused", name: "Error", path: "", errno: 0 }),
    );
    expect(e.detail).toEqual({ name: "Error", code: "ConnectionRefused", status: undefined });
  });

  it("leaves a real HTTP status alone: a 5xx is an API answer, not a transport failure", () => {
    class InternalLinearError extends Error {
      type = "InternalError";
      status = 500;
      raw = { response: { status: 500 }, code: "ECONNRESET" }; // code present but a response exists
    }
    const e = normalizeError(new InternalLinearError("Internal"));
    expect(e.code).not.toBe("network");
    expect(e.code).toBe("api");
  });

  it("still classifies the SDK's own NetworkLinearError (5xx family) as network", () => {
    class NetworkLinearError extends Error {
      status = 502;
    }
    expect(normalizeError(new NetworkLinearError("bad gateway")).code).toBe("network");
  });

  it("carries no detail for a plain error", () => {
    expect(normalizeError(new Error("boom")).detail).toBeUndefined();
  });
});

describe("CliError", () => {
  it("maps codes to exit codes", () => {
    expect(new CliError("x", "not_found").exitCode).toBe(ExitCode.NotFound);
    expect(new CliError("x", "usage").exitCode).toBe(ExitCode.Usage);
  });

  it("carries an optional structured suggestion", () => {
    const error = usageError("Bad input", "Pass --team TES.");
    expect(error.suggestion).toBe("Pass --team TES.");
  });
});
