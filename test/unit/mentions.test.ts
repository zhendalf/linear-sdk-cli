import { describe, expect, it } from "bun:test";
import { connection } from "./_fakes.js";
import {
  escapeMentionLabel,
  normalizeMentionReference,
  prependMentions,
} from "../../src/lib/mentions.js";

function fakeClient() {
  const users = [
    { id: "u-ada", displayName: "ada", name: "Ada Lovelace", email: "ada@example.com" },
    { id: "u-grace", displayName: "grace", name: "Grace Hopper", email: "g@example.com" },
  ];
  return {
    viewer: Promise.resolve({ id: "u-ada", displayName: "ada" }),
    users: async ({ filter }: any) => {
      const value =
        filter.email?.eq ?? filter.displayName?.eqIgnoreCase ?? filter.name?.eqIgnoreCase;
      return connection(
        users.filter((u) =>
          [u.email, u.displayName, u.name].some((candidate) => candidate === value),
        ),
      );
    },
    user: async (id: string) => users.find((u) => u.id === id),
  } as any;
}

describe("explicit Linear mentions", () => {
  it("leaves ordinary @name prose byte-for-byte unchanged without --mention", async () => {
    expect(await prependMentions(fakeClient(), "Thanks @ada — no notification intended")).toBe(
      "Thanks @ada — no notification intended",
    );
  });

  it("resolves repeatable references, deduplicates users, and prepends a mention paragraph", async () => {
    expect(
      await prependMentions(fakeClient(), "Please review.", ["@ada", "g@example.com", "me"]),
    ).toBe("@[ada](u-ada) @[grace](u-grace)\n\nPlease review.");
  });

  it("allows a mention-only comment", async () => {
    expect(await prependMentions(fakeClient(), "", ["me"])).toBe("@[ada](u-ada)");
  });

  it("normalizes natural @handles, rejects blank references, and escapes labels safely", () => {
    expect(normalizeMentionReference(" @ada ")).toBe("ada");
    expect(normalizeMentionReference("@me")).toBe("@me");
    expect(() => normalizeMentionReference("  ")).toThrow(/non-empty user reference/);
    expect(escapeMentionLabel(String.raw`a\b]c`)).toBe(String.raw`a\\b\]c`);
  });
});
