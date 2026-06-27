/**
 * Git integration: infer the "current issue" from the branch name, build
 * suggested branch names, and assemble commit trailers / `gh pr create` argv.
 * Pure parsing/building logic is separated for unit testing.
 */

import { execFileSync } from "node:child_process";

/**
 * Extract a Linear issue identifier (e.g. `TES-123`) from a git branch name.
 * Linear's suggested branches look like `username/tes-123-title` or
 * `tes-123-title`; we grab the first `<letters>-<digits>` token and uppercase
 * the team key.
 */
export function branchToIssueId(branch: string | undefined | null): string | undefined {
  if (!branch) return undefined;
  // Strip any leading path segment(s) like `feature/` or `user/`.
  const match = branch.match(/(?:^|[/_-])([a-zA-Z][a-zA-Z0-9]*)-(\d+)(?:$|[/_-])/);
  if (!match) return undefined;
  const [, key, num] = match;
  if (!key || !num) return undefined;
  return `${key.toUpperCase()}-${num}`;
}

/** Run a git command, returning trimmed stdout or undefined on any failure. */
function git(args: string[], cwd?: string): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
}

export function currentBranch(cwd?: string): string | undefined {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return branch && branch !== "HEAD" ? branch : undefined;
}

/** The issue identifier inferred from the current branch, if any. */
export function currentIssueId(cwd?: string): string | undefined {
  return branchToIssueId(currentBranch(cwd));
}

export function isGitRepo(cwd?: string): boolean {
  return git(["rev-parse", "--is-inside-work-tree"], cwd) === "true";
}

/**
 * Build the commit-message trailer that links a commit to a Linear issue via
 * Linear's git magic words. `Fixes <ID>` closes the issue on merge; the
 * `references` option emits `References <ID>` which links without closing.
 */
export function buildTrailer(identifier: string, opts: { references?: boolean } = {}): string {
  return `${opts.references ? "References" : "Fixes"} ${identifier}`;
}

export interface PrArgsInput {
  title: string;
  body: string;
  base?: string;
  head?: string;
  draft?: boolean;
  web?: boolean;
}

/**
 * Build the argv passed to `gh pr create`. Title and body are always present;
 * base/head/draft/web are included only when set. Pure + unit-tested so the
 * exact flag wiring is verifiable without shelling out to `gh`.
 */
export function buildPrArgs(input: PrArgsInput): string[] {
  const args = ["pr", "create", "--title", input.title, "--body", input.body];
  if (input.base) args.push("--base", input.base);
  if (input.head) args.push("--head", input.head);
  if (input.draft) args.push("--draft");
  if (input.web) args.push("--web");
  return args;
}

export interface CheckoutResult {
  branch: string;
  created: boolean;
}

/** Checkout `branch`, creating it if it does not exist. */
export function checkoutBranch(branch: string, cwd?: string): CheckoutResult {
  const exists =
    git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd) !== undefined;
  if (exists) {
    execFileSync("git", ["checkout", branch], { cwd, stdio: "ignore" });
    return { branch, created: false };
  }
  execFileSync("git", ["checkout", "-b", branch], { cwd, stdio: "ignore" });
  return { branch, created: true };
}
