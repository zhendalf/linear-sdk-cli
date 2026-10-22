import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import {
  renameApiKeyProfile,
  resolveConfig,
  userConfigPath,
  referenceCredentialsPath,
} from "../../src/config.js";
import { memoryKeyring, setKeyringBackend } from "../../src/lib/keyring.js";

let root: string;
let backend: ReturnType<typeof memoryKeyring>;
let saved: NodeJS.ProcessEnv;
const secret = "lin_api_isolated_rename_secret";
const validate = vi.fn(async (key: string) => {
  expect(key).toBe(secret);
});
const config = () => parse(fs.readFileSync(userConfigPath(), "utf8")) as any;

beforeEach(() => {
  saved = { ...process.env };
  root = fs.mkdtempSync(join(tmpdir(), "lin-profile-rename-"));
  process.env.HOME = root;
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  fs.mkdirSync(join(root, "xdg", "linear"), { recursive: true });
  backend = memoryKeyring({ old: secret });
  setKeyringBackend(backend);
  fs.writeFileSync(
    userConfigPath(),
    'default_workspace = "old"\nworkspace = "old"\nsort = "priority"\n[workspaces.old]\nkeyring = true\nteam = "ENG"\ncustom = "preserved"\n',
  );
  validate.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  setKeyringBackend(undefined);
  process.env = saved;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("API-key profile rename", () => {
  it("moves the exact key, team/default metadata and shared list, preserving other settings", async () => {
    fs.writeFileSync(
      referenceCredentialsPath(),
      'default = "old"\nworkspaces = ["old", "other"]\nextra = "keep"\n',
    );
    const result = await renameApiKeyProfile("old", "new", validate);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      storage: "keychain",
      team: "ENG",
      defaultWorkspace: "new",
      referenceCredentialsPath: referenceCredentialsPath(),
    });
    expect(backend.store).toEqual(new Map([["new", secret]]));
    expect(config()).toEqual({
      default_workspace: "new",
      workspace: "new",
      sort: "priority",
      workspaces: { new: { keyring: true, team: "ENG", custom: "preserved" } },
    });
    expect(parse(fs.readFileSync(referenceCredentialsPath(), "utf8"))).toEqual({
      default: "new",
      workspaces: ["new", "other"],
      extra: "keep",
    });
    expect(fs.readFileSync(userConfigPath(), "utf8")).not.toContain(secret);
    expect(fs.statSync(userConfigPath()).mode & 0o777).toBe(0o600);
    const fresh = resolveConfig({
      cwd: root,
      env: { HOME: root, XDG_CONFIG_HOME: join(root, "xdg") },
    });
    expect(fresh).toMatchObject({ apiKey: secret, credentialWorkspace: "new", team: "ENG" });
  });

  it("preserves plaintext storage without requiring a keyring or adding a default", async () => {
    setKeyringBackend(null);
    fs.writeFileSync(
      userConfigPath(),
      `[workspaces.old]\napi_key = "${secret}"\nteam = "ENG"\n[workspaces.other]\napi_key = "other-secret"\n`,
    );
    expect(await renameApiKeyProfile("old", "new", validate)).toMatchObject({
      storage: "file",
      defaultWorkspace: null,
    });
    expect(config().workspaces.new).toEqual({ api_key: secret, team: "ENG" });
    expect(config().workspaces.other.api_key).toBe("other-secret");
    expect(config().default_workspace).toBeUndefined();
  });

  it("imports a reference-only profile and preserves its default", async () => {
    fs.rmSync(userConfigPath());
    fs.writeFileSync(referenceCredentialsPath(), 'default = "old"\nworkspaces = ["old"]\n');
    expect(await renameApiKeyProfile("old", "new", validate)).toMatchObject({
      defaultWorkspace: "new",
    });
    expect(config().workspaces.new.keyring).toBe(true);
  });

  it("leaves the reference inline-key format byte-for-byte unchanged", async () => {
    const text = 'other = "unrelated-inline-secret"\n';
    fs.writeFileSync(referenceCredentialsPath(), text);
    await renameApiKeyProfile("old", "new", validate);
    expect(fs.readFileSync(referenceCredentialsPath(), "utf8")).toBe(text);
  });

  it("preserves a different default and unrelated profiles", async () => {
    fs.writeFileSync(
      userConfigPath(),
      'default_workspace = "other"\n[workspaces.old]\nkeyring = true\nteam = "ENG"\n[workspaces.other]\napi_key = "unrelated"\nteam = "OPS"\n',
    );
    const result = await renameApiKeyProfile("old", "new", validate);
    expect(result.defaultWorkspace).toBe("other");
    expect(config().workspaces.other).toEqual({ api_key: "unrelated", team: "OPS" });
  });

  it("refuses unavailable stored credentials and hides keyring read errors", async () => {
    const before = fs.readFileSync(userConfigPath(), "utf8");
    backend.get = () => {
      throw new Error(secret);
    };
    await expect(renameApiKeyProfile("old", "new", validate)).rejects.toThrow(
      "Could not inspect the system keyring",
    );
    backend.get = () => null;
    await expect(renameApiKeyProfile("old", "new", validate)).rejects.toThrow(
      "stored API key is unavailable",
    );
    expect(validate).not.toHaveBeenCalled();
    expect(fs.readFileSync(userConfigPath(), "utf8")).toBe(before);
  });

  it("does not treat an inherited object property as a configured source", async () => {
    backend.store.set("constructor", secret);
    await expect(renameApiKeyProfile("constructor", "new", validate)).rejects.toThrow(
      "not configured",
    );
    expect(validate).not.toHaveBeenCalled();
  });

  for (const target of ["metadata", "reference", "keyring", "oauth", "app"]) {
    it(`refuses a ${target} destination collision, including unlisted secrets`, async () => {
      if (target === "metadata")
        fs.appendFileSync(userConfigPath(), '\n[workspaces.new]\nteam = "NEW"\n');
      if (target === "reference")
        fs.writeFileSync(referenceCredentialsPath(), 'workspaces = ["new"]\n');
      if (target === "keyring") backend.store.set("new", secret);
      if (target === "oauth") backend.store.set("oauth:new", "oauth-destination-secret");
      if (target === "app") backend.store.set("app:new", "app-destination-secret");
      const before = fs.readFileSync(userConfigPath(), "utf8");
      const keys = new Map(backend.store);
      await expect(renameApiKeyProfile("old", "new", validate)).rejects.toThrow(/already|OAuth/);
      expect(validate).not.toHaveBeenCalled();
      expect(fs.readFileSync(userConfigPath(), "utf8")).toBe(before);
      expect(backend.store).toEqual(keys);
    });
  }

  for (const marker of [
    "oauth = true",
    "app = true",
    'app_credentials = { client_secret = "app-secret" }',
  ]) {
    it(`refuses the OAuth lifecycle ${marker.split(" =")[0]} before validation or mutation`, async () => {
      fs.appendFileSync(userConfigPath(), marker + "\n");
      const before = fs.readFileSync(userConfigPath(), "utf8");
      await expect(renameApiKeyProfile("old", "new", validate)).rejects.toThrow(
        "supports API-key profiles only",
      );
      expect(validate).not.toHaveBeenCalled();
      expect(fs.readFileSync(userConfigPath(), "utf8")).toBe(before);
      expect(backend.store).toEqual(new Map([["old", secret]]));
    });
  }

  it("refuses dormant OAuth source records rather than leaving a grant under the old name", async () => {
    backend.store.set("oauth:old", "refresh-secret");
    await expect(renameApiKeyProfile("old", "new", validate)).rejects.toThrow(
      "OAuth keyring record",
    );
    expect(backend.store.has("new")).toBe(false);
  });

  it("does not mutate when identity validation fails", async () => {
    const before = fs.readFileSync(userConfigPath(), "utf8");
    await expect(
      renameApiKeyProfile("old", "new", async () => {
        throw new Error("wrong workspace");
      }),
    ).rejects.toThrow("wrong workspace");
    expect(fs.readFileSync(userConfigPath(), "utf8")).toBe(before);
    expect(backend.store).toEqual(new Map([["old", secret]]));
  });

  for (const change of ["keyring", "config", "reference", "oauth", "app"]) {
    it(`detects a concurrent ${change} change during validation`, async () => {
      await expect(
        renameApiKeyProfile("old", "new", async () => {
          if (change === "keyring") backend.store.set("old", "changed-secret");
          if (change === "oauth") backend.store.set("oauth:new", "new-oauth-secret");
          if (change === "app") backend.store.set("app:new", "new-app-secret");
          if (change === "config") fs.appendFileSync(userConfigPath(), 'extra = "changed"\n');
          if (change === "reference")
            fs.writeFileSync(referenceCredentialsPath(), 'workspaces = ["other"]\n');
        }),
      ).rejects.toThrow("changed during validation");
      expect(backend.store.has("new")).toBe(false);
      expect(config().api_key_profile_rename).toBeUndefined();
    });
  }

  for (const [from, to] of [
    ["old", "old"],
    ["", "new"],
    ["old", "New"],
    ["old", "new\n"],
  ]) {
    it(`rejects invalid slugs ${JSON.stringify([from, to])}`, async () => {
      await expect(renameApiKeyProfile(from!, to!, validate)).rejects.toThrow(
        "different lowercase",
      );
      expect(validate).not.toHaveBeenCalled();
    });
  }
});

describe("rename failure recovery", () => {
  it("verifies destination readback before moving metadata or deleting the source", async () => {
    const set = backend.set;
    backend.set = () => {};
    await expect(renameApiKeyProfile("old", "new", validate)).rejects.toThrow("copy and verify");
    expect(backend.store.get("old")).toBe(secret);
    expect(config().workspaces.old.team).toBe("ENG");
    backend.set = set;
    await renameApiKeyProfile("old", "new", validate);
    expect(backend.store.get("new")).toBe(secret);
  });

  it("refuses a changed storage lifecycle during recovery", async () => {
    fs.writeFileSync(userConfigPath(), `[workspaces.old]\napi_key = "${secret}"\n`);
    backend.store.clear();
    const rename = fs.renameSync;
    let writes = 0;
    const failure = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (target === userConfigPath() && ++writes === 2) throw new Error("disk failure");
      rename(source, target);
    });
    await expect(renameApiKeyProfile("old", "new", validate)).rejects.toThrow("incomplete");
    failure.mockRestore();
    backend.store.set("old", secret);
    await expect(renameApiKeyProfile("old", "new", validate)).rejects.toThrow("storage changed");
    expect(config().workspaces.old.api_key).toBe(secret);
    expect(backend.store.get("old")).toBe(secret);
  });

  for (const stage of [
    "copy-before",
    "copy-after",
    "commit",
    "reference",
    "delete-before",
    "delete-after",
    "finish",
  ]) {
    it(`resumes safely after a ${stage} failure without exposing the store error`, async () => {
      fs.writeFileSync(referenceCredentialsPath(), 'default = "old"\nworkspaces = ["old"]\n');
      const set = backend.set.bind(backend);
      const del = backend.delete.bind(backend);
      const rename = fs.renameSync;
      let writes = 0;
      const filesystemFailure = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
        if (target === userConfigPath()) writes++;
        if (
          (stage === "commit" && writes === 2 && target === userConfigPath()) ||
          (stage === "finish" && writes === 3 && target === userConfigPath()) ||
          (stage === "reference" && target === referenceCredentialsPath())
        )
          throw new Error(secret);
        rename(source, target);
      });
      backend.set = (account, value) => {
        if (stage === "copy-before") throw new Error(secret);
        set(account, value);
        if (stage === "copy-after") throw new Error(secret);
      };
      backend.delete = (account) => {
        if (stage === "delete-before") throw new Error(secret);
        const result = del(account);
        if (stage === "delete-after") throw new Error(secret);
        return result;
      };
      let error: unknown;
      try {
        await renameApiKeyProfile("old", "new", validate);
      } catch (err) {
        error = err;
      }
      expect(String(error)).toContain("Rerun `linear auth rename old new`");
      expect(String(error)).not.toContain(secret);
      expect([...backend.store.values()]).toContain(secret);
      expect(config().api_key_profile_rename).toBeDefined();
      filesystemFailure.mockRestore();
      backend.set = set;
      backend.delete = del;
      await renameApiKeyProfile("old", "new", validate);
      expect(backend.store).toEqual(new Map([["new", secret]]));
      expect(config().workspaces.new.team).toBe("ENG");
      expect(config().workspaces.old).toBeUndefined();
      expect(config().api_key_profile_rename).toBeUndefined();
      expect(parse(fs.readFileSync(referenceCredentialsPath(), "utf8"))).toEqual({
        default: "new",
        workspaces: ["new"],
      });
    });
  }

  it("will not delete a source credential changed after a committed rename", async () => {
    backend.delete = () => {
      throw new Error("locked");
    };
    await expect(renameApiKeyProfile("old", "new", validate)).rejects.toThrow("incomplete");
    backend.store.set("old", "newly-replaced-source");
    backend.delete = (account) => backend.store.delete(account);
    await expect(renameApiKeyProfile("old", "new", validate)).rejects.toThrow(
      "changed or conflicts",
    );
    expect(backend.store.get("old")).toBe("newly-replaced-source");
    expect(backend.store.get("new")).toBe(secret);
  });

  it("requires the original pair while an operation is pending", async () => {
    backend.set = () => {
      throw new Error("locked");
    };
    await expect(renameApiKeyProfile("old", "new", validate)).rejects.toThrow("incomplete");
    await expect(renameApiKeyProfile("old", "other", validate)).rejects.toThrow(
      "Another profile rename is pending",
    );
  });
});
