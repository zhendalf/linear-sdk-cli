import { afterAll, beforeAll, describe, expect, it, vi } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { connection, payload } from "../unit/_fakes.js";

const ISSUE = { id: "issue-uuid-42", identifier: "TES-42", title: "Test issue" };
const COMMENT = { id: "comment-uuid", url: "https://linear.app/c/comment-uuid" };

let client: any;
let clientDescriptor: PropertyDescriptor | undefined;
let savedKey: string | undefined;
let root: string;
let bodyFile: string;

beforeAll(() => {
  savedKey = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = "lin_api_contract000000000000";
  clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
  Object.defineProperty(Context.prototype, "client", {
    configurable: true,
    get: () => client,
  });
  root = mkdtempSync(join(tmpdir(), "lin-comment-create-contract-"));
  bodyFile = join(root, "comment.md");
  writeFileSync(bodyFile, "Contract body\n");
});

afterAll(() => {
  if (clientDescriptor) Object.defineProperty(Context.prototype, "client", clientDescriptor);
  if (savedKey === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = savedKey;
  rmSync(root, { recursive: true, force: true });
});

async function run(args: string[]): Promise<{ stdout: string; stderr: string }> {
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
    await createProgram().parseAsync(["node", "linear", ...args]);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return { stdout, stderr };
}

describe("comment create alias CLI contract", () => {
  for (const path of [
    ["comment", "create"],
    ["issue", "comment", "create"],
  ]) {
    it(`${path.join(" ")} uses the add handler and preserves the JSON receipt`, async () => {
      client = {
        issues: vi.fn(async () => connection([ISSUE])),
        createComment: vi.fn(async () => payload("comment", COMMENT)),
      };

      const { stdout, stderr } = await run([
        ...path,
        ISSUE.identifier,
        "--body-file",
        bodyFile,
        "--json",
      ]);

      expect(client.createComment).toHaveBeenCalledWith({
        issueId: ISSUE.id,
        body: "Contract body\n",
      });
      expect(JSON.parse(stdout)).toEqual({
        id: COMMENT.id,
        issue: ISSUE.identifier,
        url: COMMENT.url,
      });
      expect(stderr).toBe("");
    });
  }
});
