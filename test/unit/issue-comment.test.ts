/**
 * `linear issue comment [id] [body]` — the README's headline `issue comment
 * "<body>"` on a matching branch — run through the real program in a scratch
 * git repository. The API is a fake client hung off Context; nothing leaves
 * the machine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { connection, payload } from "./_fakes.js";

let root: string;
let repo: string;
let savedCwd: string;
let savedEnv: Record<string, string | undefined>;
let clientDescriptor: PropertyDescriptor | undefined;

/** What the fake client saw. */
let issueQueries: any[];
let created: any[];

function fakeClient(exists = true) {
  const issue = { id: "issue-uuid-123", identifier: "TES-123", title: "x" };
  const users = [{ id: "u-ada", displayName: "ada", name: "Ada", email: "ada@example.com" }];
  return {
    issues: async (args: any) => {
      issueQueries.push(args);
      return connection(exists ? [issue] : []);
    },
    createComment: async (input: any) => {
      created.push(input);
      return payload("comment", { id: "comment-uuid", url: "https://linear.app/c/1" });
    },
    users: async () => connection(users),
    user: async (id: string) => users.find((u) => u.id === id),
  };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lincomment-")));
  repo = join(root, "repo");
  mkdirSync(repo);
  // A branch needs a commit before `rev-parse --abbrev-ref HEAD` will name it.
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  execFileSync("git", ["init", "-q", "-b", "tes-123-x"], { cwd: repo, env: gitEnv });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo, env: gitEnv });
  savedCwd = process.cwd();
  process.chdir(repo);
  // Isolate config; give the process a key so the client is constructible.
  savedEnv = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    HOME: process.env.HOME,
    LINEAR_API_KEY: process.env.LINEAR_API_KEY,
  };
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  process.env.HOME = root;
  process.env.LINEAR_API_KEY = "lin_api_test000000000000";
  issueQueries = [];
  created = [];
  clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
  Object.defineProperty(Context.prototype, "client", {
    get: () => fakeClient(),
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (clientDescriptor) Object.defineProperty(Context.prototype, "client", clientDescriptor);
  process.chdir(savedCwd);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
});

async function runJson(args: string[]): Promise<any> {
  let out = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
    out += c;
    return true;
  });
  try {
    await createProgram().parseAsync(["node", "linear", ...args, "--json"]);
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(out);
}
const run = (args: string[]) => createProgram().parseAsync(["node", "linear", ...args, "--json"]);

describe("issue comment on a matching branch (tes-123-x)", () => {
  it('`issue comment "<body>"` — one operand that is not an id is the body; the id comes from the branch', async () => {
    const out = await runJson(["issue", "comment", "shipped — please review"]);
    expect(out).toEqual({ id: "comment-uuid", issue: "TES-123" });
    // Resolved TES-123 from the branch, and posted exactly that body.
    expect(issueQueries[0].filter).toEqual({ team: { key: { eq: "TES" } }, number: { eq: 123 } });
    expect(created).toEqual([{ issueId: "issue-uuid-123", body: "shipped — please review" }]);
  });

  it("two operands are (id, body), as always", async () => {
    await runJson(["issue", "comment", "TES-7", "hello"]);
    expect(issueQueries[0].filter.number).toEqual({ eq: 7 });
    expect(created[0].body).toBe("hello");
  });

  it("--mention emits a real Linear mention while literal @name text stays literal", async () => {
    await runJson(["issue", "comment", "TES-7", "literal @grace stays prose", "--mention", "@ada"]);
    expect(created[0].body).toBe("@[ada](u-ada)\n\nliteral @grace stays prose");
  });

  it("allows an intentional mention-only comment", async () => {
    await runJson(["issue", "comment", "TES-7", "--mention", "ada"]);
    expect(created[0].body).toBe("@[ada](u-ada)");
  });

  it("a lone operand that looks like an id IS the id; the body then comes from --body-file", async () => {
    const file = join(root, "body.md");
    writeFileSync(file, "from a file\n");
    await runJson(["issue", "comment", "TES-9", "--body-file", file]);
    expect(issueQueries[0].filter.number).toEqual({ eq: 9 });
    expect(created[0].body).toBe("from a file\n");
    // …and with neither body nor file, non-interactively, it is a usage error — not an
    // editor and not an id error.
    await expect(run(["issue", "comment", "TES-9"])).rejects.toThrow(/No comment body provided/);
    expect(created).toHaveLength(1);
  });

  it("no operands: id from the branch, body from --body-file -", async () => {
    // (stdin is not readable here; a file stands in for the '-' path)
    const file = join(root, "body.md");
    writeFileSync(file, "branch + file");
    const out = await runJson(["issue", "comment", "--body-file", file]);
    expect(out.issue).toBe("TES-123");
    expect(created[0].body).toBe("branch + file");
  });

  it("the id is settled before any body work: off a matching branch, a bare body fails on the id", async () => {
    execFileSync("git", ["checkout", "-q", "-b", "main"], { cwd: repo });
    await expect(run(["issue", "comment", "shipped"])).rejects.toThrow(
      /No issue id given and none could be inferred/,
    );
    expect(issueQueries).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it("the reference layout `issue comment add <issue> <body>` still dispatches to the subcommand", async () => {
    await runJson(["issue", "comment", "add", "TES-5", "via add"]);
    expect(issueQueries[0].filter.number).toEqual({ eq: 5 });
    expect(created[0].body).toBe("via add");
  });
});
