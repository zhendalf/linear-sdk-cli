import { afterAll, beforeAll, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { connection, payload } from "../unit/_fakes.js";

const EXAMPLE =
  "linear attachment create TES-123 --url https://example.invalid/pr/1 --title 'PR #1' --json";

let client: any;
let clientDescriptor: PropertyDescriptor | undefined;
let savedKey: string | undefined;

beforeAll(() => {
  savedKey = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = "lin_api_contract000000000000";
  clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
  Object.defineProperty(Context.prototype, "client", {
    configurable: true,
    get: () => client,
  });
});

afterAll(() => {
  if (clientDescriptor) Object.defineProperty(Context.prototype, "client", clientDescriptor);
  if (savedKey === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = savedKey;
});

it("the documented URL attachment workflow supplies all required options and emits a receipt", async () => {
  for (const path of ["../../README.md", "../../skills/linear-sdk-cli/SKILL.md"]) {
    expect(readFileSync(new URL(path, import.meta.url), "utf8")).toContain(EXAMPLE);
  }

  const attachment = { id: "attachment-uuid", title: "PR #1", url: "https://example.invalid/pr/1" };
  client = {
    issues: vi.fn(async () => connection([{ id: "issue-uuid", identifier: "TES-123" }])),
    createAttachment: vi.fn(async () => payload("attachment", attachment)),
  };

  let stdout = "";
  let stderr = "";
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdout += chunk;
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    stderr += chunk;
    return true;
  });
  try {
    await createProgram().parseAsync([
      "node",
      "linear",
      "attachment",
      "create",
      "TES-123",
      "--url",
      attachment.url,
      "--title",
      attachment.title,
      "--json",
    ]);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }

  expect(client.createAttachment).toHaveBeenCalledWith({
    issueId: "issue-uuid",
    url: attachment.url,
    title: attachment.title,
  });
  expect(JSON.parse(stdout)).toEqual(attachment);
  expect(stderr).toBe("");
});
