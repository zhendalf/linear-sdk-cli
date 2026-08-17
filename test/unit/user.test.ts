import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { createProgram } from "../../src/cli.js";
import { Context } from "../../src/context.js";
import { listUsers, getUserDetail, getViewer } from "../../src/services/user.js";
import { connection } from "./_fakes.js";

/** Build a fake User SDK model. */
function fakeUser(over: Record<string, any> = {}): Record<string, any> {
  return {
    id: "u1",
    displayName: "ada",
    name: "Ada Lovelace",
    email: "ada@example.com",
    active: true,
    admin: false,
    guest: false,
    isMe: false,
    description: null,
    statusLabel: null,
    timezone: "UTC",
    url: "https://linear.app/u/ada",
    avatarUrl: null,
    lastSeen: new Date("2026-01-02T03:04:05.000Z"),
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  };
}

// A faithful SDK connection (see _fakes.ts): fetchNext() mutates and returns
// `this`, which is what the real one does and what an ad-hoc literal did not.
const conn = <T,>(nodes: T[]) => connection(nodes) as any;

describe("listUsers", () => {
  it("maps the user connection to display rows", async () => {
    const client = {
      users: async () => conn([fakeUser(), fakeUser({ id: "u2", displayName: "grace", admin: true })]),
    } as any;
    const rows = await listUsers(client, 50);
    expect(rows).toEqual([
      {
        id: "u1",
        displayName: "ada",
        name: "Ada Lovelace",
        email: "ada@example.com",
        active: true,
        admin: false,
        guest: false,
      },
      {
        id: "u2",
        displayName: "grace",
        name: "Ada Lovelace",
        email: "ada@example.com",
        active: true,
        admin: true,
        guest: false,
      },
    ]);
  });

  it("requests at most 100 per page even for a large limit", async () => {
    let requested: number | undefined;
    const client = {
      users: async (vars: any) => {
        requested = vars.first;
        return conn([fakeUser()]);
      },
    } as any;
    await listUsers(client, Infinity);
    expect(requested).toBe(100);
  });

  // Linear defaults includeDisabled to false, so omitting it hides deactivated
  // users entirely and makes the `active` column constantly true.
  it("excludes deactivated users by default and opts in explicitly", async () => {
    const seen: Array<boolean | undefined> = [];
    const client = {
      users: async (vars: any) => {
        seen.push(vars.includeDisabled);
        return conn([fakeUser()]);
      },
    } as any;
    await listUsers(client, 50);
    await listUsers(client, 50, true);
    expect(seen).toEqual([false, true]);
  });
});

describe("getUserDetail", () => {
  it("resolves a user id (uuid passes through) and shapes the detail", async () => {
    const id = "01234567-89ab-cdef-0123-456789abcdef";
    let lookedUp: string | undefined;
    const client = {
      user: async (uid: string) => {
        lookedUp = uid;
        return fakeUser({ id: uid, statusLabel: "On vacation", description: "Engineer" });
      },
    } as any;
    const d = await getUserDetail(client, id);
    expect(lookedUp).toBe(id);
    expect(d.id).toBe(id);
    expect(d.statusLabel).toBe("On vacation");
    expect(d.description).toBe("Engineer");
    expect(d.lastSeen).toBe("2026-01-02T03:04:05.000Z");
    expect(d.createdAt).toBe("2025-01-01T00:00:00.000Z");
  });

  it("resolves 'me' via the viewer", async () => {
    const client = {
      viewer: Promise.resolve(fakeUser({ id: "viewer-id" })),
      user: async (uid: string) => fakeUser({ id: uid, isMe: true }),
    } as any;
    const d = await getUserDetail(client, "me");
    expect(d.id).toBe("viewer-id");
    expect(d.isMe).toBe(true);
  });
});

describe("getViewer", () => {
  it("shapes the authenticated viewer", async () => {
    const client = {
      viewer: Promise.resolve(fakeUser({ id: "me-id", displayName: "me", isMe: true })),
    } as any;
    const d = await getViewer(client);
    expect(d.id).toBe("me-id");
    expect(d.isMe).toBe(true);
    expect(d.email).toBe("ada@example.com");
  });
});

// ---------------------------------------------------------------------------
// Command level: `--all` is pagination, not "include deactivated" (TES-637 #1).
// ---------------------------------------------------------------------------
/**
 * schpet's `user list --all` / `team members --all` include inactive members;
 * ours is the global "exhaust pagination", and the flag for deactivated users
 * is `--include-disabled`. Same command line, both exit 0, different rows —
 * the silent-divergence class. `--all` keeps its one meaning; the listing says
 * on stderr what it did NOT do, and names the flag that does.
 */
describe("`user list --all` / `team members --all` warn that deactivated users are still excluded", () => {
  let savedEnv: Record<string, string | undefined>;
  let clientDescriptor: PropertyDescriptor | undefined;
  let requested: any[] = [];

  function fakeClient() {
    return {
      users: async (vars: any) => {
        requested.push(vars);
        return conn([fakeUser()]);
      },
      teams: async () => conn([{ id: "team-1", key: "TES", name: "Test" }]),
      team: async () => ({
        id: "team-1",
        key: "TES",
        name: "Test",
        members: async (vars: any) => {
          requested.push(vars);
          return conn([fakeUser()]);
        },
      }),
    } as any;
  }

  beforeEach(() => {
    requested = [];
    savedEnv = { LINEAR_API_KEY: process.env.LINEAR_API_KEY, LINEAR_TEAM: process.env.LINEAR_TEAM };
    process.env.LINEAR_API_KEY = "lin_api_test000000000000";
    process.env.LINEAR_TEAM = "TES";
    clientDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, "client");
    Object.defineProperty(Context.prototype, "client", { get: () => fakeClient(), configurable: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (clientDescriptor) Object.defineProperty(Context.prototype, "client", clientDescriptor);
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /** Run through the real program (JSON on stdout, both silenced) and hand back stderr. */
  async function run(args: string[]): Promise<string> {
    let stderr = "";
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
      stderr += String(chunk);
      return true;
    });
    try {
      await createProgram().parseAsync(["node", "linear", ...args, "--json"]);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    return stderr;
  }

  it("user list --all: exhausts pagination (as documented) AND warns, naming --include-disabled", async () => {
    const stderr = await run(["user", "list", "--all"]);
    expect(stderr).toMatch(/--all exhausts pagination here; deactivated users are still excluded.*--include-disabled/);
  });

  it("team members --all: the same warning", async () => {
    const stderr = await run(["team", "members", "--all"]);
    expect(stderr).toMatch(/deactivated users are still excluded.*--include-disabled/);
  });

  it("the warning survives --quiet: a script is where a wrong result set goes unnoticed", async () => {
    const stderr = await run(["user", "list", "--all", "--quiet"]);
    expect(stderr).toMatch(/--include-disabled/);
  });

  it("is silent with --include-disabled alongside, and without --all at all", async () => {
    expect(await run(["user", "list", "--all", "--include-disabled"])).toBe("");
    expect(await run(["user", "list"])).toBe("");
    expect(await run(["user", "list", "--limit", "0"])).toBe(""); // --limit 0 is our own spelling, not schpet's --all
    expect(await run(["team", "members", "--include-disabled", "--all"])).toBe("");
  });

  it("--help says it up front on both commands", () => {
    const program = createProgram();
    const userList = program.commands.find((c) => c.name() === "user")!.commands.find((c) => c.name() === "list")!;
    const teamMembers = program.commands.find((c) => c.name() === "team")!.commands.find((c) => c.name() === "members")!;
    for (const cmd of [userList, teamMembers]) {
      // The note is `addHelpText("after")`, which only `outputHelp()` renders.
      let help = "";
      cmd.configureOutput({ writeOut: (s) => void (help += s) });
      cmd.outputHelp();
      expect(help).toMatch(/Deactivated users need --include-disabled/);
    }
  });
});
