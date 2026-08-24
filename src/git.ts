/**
 * Git integration: infer the "current issue" from the branch name, build
 * suggested branch names, and assemble commit trailers / `gh pr create` argv.
 * Pure parsing/building logic is separated for unit testing.
 */

import { execFileSync } from "node:child_process";
import { CliError } from "./lib/errors.js";

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
 * The Linear magic-word phrase that links a commit or PR to an issue: `Fixes
 * <ID>` closes the issue on merge; the `references` option gives `References
 * <ID>`, which links without closing. Both are on Linear's list of recognized
 * words (linear.app/docs/github); the word must sit directly before the id.
 */
export function buildTrailer(identifier: string, opts: { references?: boolean } = {}): string {
  return `${opts.references ? "References" : "Fixes"} ${identifier}`;
}

/**
 * The two git trailers `issue describe` and `issue pull-request` emit — the
 * exact lines schpet/linear-cli writes (T `src/utils/jj.ts`), so a transplanted
 * `git commit -m "$(linear issue describe)"` produces the same commit:
 *
 *     Linear-issue: Fixes TES-123
 *     Linear-issue-url: https://linear.app/…/issue/TES-123/…
 *
 * Proper `Key: value` trailers rather than a bare `Fixes TES-123` line, on
 * purpose: `git interpret-trailers` / `git log --format=%(trailers:key=Linear-issue)`
 * and jj's `trailers` template can read them back (schpet's jj mode infers the
 * current issue from exactly this trailer), while Linear still sees the magic
 * word directly before the id and links — and closes — the issue. The URL line is
 * for the humans reading the log.
 */
export function buildTrailers(
  identifier: string,
  url: string,
  opts: { references?: boolean } = {},
): string {
  return `Linear-issue: ${buildTrailer(identifier, opts)}\nLinear-issue-url: ${url}`;
}

/**
 * What `issue describe` prints: schpet's subject line (`ID Title`), a blank
 * line, then the trailers. Piped into `git commit -m` / `jj describe -m` it is
 * the whole message.
 */
export function buildDescription(
  identifier: string,
  title: string,
  url: string,
  opts: { references?: boolean } = {},
): string {
  return `${identifier} ${title}\n\n${buildTrailers(identifier, url, opts)}`;
}

/**
 * The title and body `issue pull-request` hands to `gh pr create`: schpet's
 * `ID Title` (a custom title is prefixed the same way), and the two trailers as
 * the body — the URL for the humans, the magic word so Linear links (and, on
 * merge, closes) the issue even when the branch name does not carry the id.
 */
export function buildPrContent(
  issue: { identifier: string; title: string; url: string },
  customTitle?: string,
): { title: string; body: string } {
  return {
    title: `${issue.identifier} ${customTitle ?? issue.title}`,
    body: buildTrailers(issue.identifier, issue.url),
  };
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

/** Run the mutating checkout command and retain git's explanation on failure. */
function gitCheckout(args: string[], cwd?: string): void {
  try {
    execFileSync("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number; stderr?: Buffer | string };
    if (e.code === "ENOENT")
      throw new CliError("Git is required to check out an issue branch.", "runtime");
    const stderr = e.stderr ? e.stderr.toString().trim() : "";
    throw new CliError(
      stderr || `git ${args.join(" ")} exited with code ${e.status ?? 1}.`,
      "runtime",
    );
  }
}

/** Checkout `branch`, creating it if it does not exist. */
export function checkoutBranch(branch: string, cwd?: string): CheckoutResult {
  const exists =
    git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd) !== undefined;
  if (exists) {
    gitCheckout(["checkout", branch], cwd);
    return { branch, created: false };
  }
  gitCheckout(["checkout", "-b", branch], cwd);
  return { branch, created: true };
}
