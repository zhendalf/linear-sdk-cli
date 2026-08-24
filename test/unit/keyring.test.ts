import { describe, it, expect, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  keyring,
  macosKeychain,
  memoryKeyring,
  setKeyringBackend,
  KeyringError,
  KEYRING_SERVICE,
} from "../../src/lib/keyring.js";

describe("keyring selection", () => {
  it("uses the reference CLI's service name so its entries are found", () => {
    expect(KEYRING_SERVICE).toBe("linear-cli");
  });

  it("the test seam replaces detection, and `undefined` restores it", () => {
    const fake = memoryKeyring({ a: "1" });
    setKeyringBackend(fake);
    expect(keyring()).toBe(fake);
    setKeyringBackend(null);
    expect(keyring()).toBeNull();
    setKeyringBackend(undefined);
    const real = keyring();
    if (process.platform === "darwin") expect(real).toBe(macosKeychain);
    else if (process.platform !== "linux") expect(real).toBeNull();
  });
});

/**
 * The real macOS Keychain, through /usr/bin/security, on a throwaway
 * `clitest-` account that is created and deleted here. This is deliberately
 * opt-in: normal unit tests must never create a real Keychain item or trigger
 * macOS credential UI. Run it explicitly with `LINEAR_LIVE_KEYRING_TESTS=1`.
 */
const onMac = process.platform === "darwin" && process.env.LINEAR_LIVE_KEYRING_TESTS === "1";
describe.skipIf(!onMac)("macOS Keychain backend (live, clitest- account)", () => {
  const account = `clitest-keyring-${process.pid}`;

  afterAll(() => {
    // Belt and braces: never leave a test item behind.
    spawnSync("/usr/bin/security", [
      "delete-generic-password",
      "-a",
      account,
      "-s",
      KEYRING_SERVICE,
    ]);
  });

  it("round-trips a secret without ever putting it on argv, and reports absence as null", () => {
    expect(macosKeychain.get(account)).toBeNull();
    macosKeychain.set(account, "lin_api_clitest0000000000");
    expect(macosKeychain.get(account)).toBe("lin_api_clitest0000000000");
    // -U: a second set replaces rather than fails.
    macosKeychain.set(account, "lin_api_clitest0000000001");
    expect(macosKeychain.get(account)).toBe("lin_api_clitest0000000001");
    // The stored item carries the reference CLI's attributes exactly.
    const r = spawnSync(
      "/usr/bin/security",
      ["find-generic-password", "-a", account, "-s", KEYRING_SERVICE],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`"svce"<blob>="${KEYRING_SERVICE}"`);
    expect(r.stdout).toContain(`"acct"<blob>="${account}"`);
    expect(macosKeychain.delete(account)).toBe(true);
    expect(macosKeychain.delete(account)).toBe(false);
    expect(macosKeychain.get(account)).toBeNull();
  });

  it("quotes for `security -i` so quotes and backslashes survive, and refuses a line break", () => {
    macosKeychain.set(account, 'a b"c\\d');
    expect(macosKeychain.get(account)).toBe('a b"c\\d');
    macosKeychain.delete(account);
    expect(() => macosKeychain.set(account, "one\ntwo")).toThrow(KeyringError);
    expect(macosKeychain.get(account)).toBeNull();
  });
});
