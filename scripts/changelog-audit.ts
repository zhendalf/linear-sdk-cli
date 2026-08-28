/**
 * Changelog integrity audit.
 *
 * Release Please is the only routine writer of CHANGELOG.md. This audit keeps the generated
 * release history aligned with package.json and the repository's published tags, and it rejects
 * hand-edited changelogs on otherwise-clean pull request bases.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

interface ReleaseHeading {
  version: string;
  link?: string;
  date?: string;
  line: number;
}

interface AuditOptions {
  tags?: string[];
  releaseTag?: string;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const HEADING = /^## \[([^\]]+)\](?:\(([^)]+)\))?(?: \((\d{4}-\d{2}-\d{2})\))?$/;

function normalizeVersion(value: string): string {
  return value.startsWith("v") ? value.slice(1) : value;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseHeadings(changelog: string): ReleaseHeading[] {
  const headings: ReleaseHeading[] = [];
  for (const [index, line] of changelog.split("\n").entries()) {
    if (!line.startsWith("## ")) continue;
    const match = line.match(HEADING);
    if (!match || match[1] === "Unreleased") continue;
    headings.push({
      version: match[1] ?? "",
      link: match[2],
      date: match[3],
      line: index + 1,
    });
  }
  return headings;
}

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function normalizeGeneratedBullet(line: string): string {
  let normalized = line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim()
    .toLowerCase();
  const releaseMetadata = /\s+\((?:#[0-9]+|[a-z][a-z0-9]*-[0-9]+|[0-9a-f]{7,40})\)$/i;
  while (releaseMetadata.test(normalized)) normalized = normalized.replace(releaseMetadata, "");
  return normalized.replace(/[*_`]/g, "").replace(/\s+/g, " ");
}

function duplicateGeneratedEntries(changelog: string): string[] {
  const duplicates: string[] = [];
  let release = "";
  let seen = new Map<string, number>();

  for (const [index, line] of changelog.split("\n").entries()) {
    const heading = line.match(HEADING);
    if (heading && heading[1] !== "Unreleased") {
      release = heading[1] ?? "";
      seen = new Map<string, number>();
      continue;
    }
    if (!release || !line.startsWith("- ") || !line.includes("/commit/")) continue;
    const normalized = normalizeGeneratedBullet(line);
    const firstLine = seen.get(normalized);
    if (firstLine) {
      duplicates.push(
        `release ${release} has duplicate generated entries on lines ${firstLine} and ${index + 1}`,
      );
    } else {
      seen.set(normalized, index + 1);
    }
  }

  return duplicates;
}

export function auditChangelog(
  changelog: string,
  packageVersion: string,
  options: AuditOptions = {},
): string[] {
  const errors: string[] = [];
  if (/^## \[Unreleased\]/m.test(changelog)) {
    errors.push("CHANGELOG.md contains an Unreleased section; Release Please is the sole writer");
  }

  const releases = parseHeadings(changelog);
  if (releases.length === 0) return [...errors, "CHANGELOG.md has no version headings"];

  if (releases[0]?.version !== packageVersion) {
    errors.push(
      `first changelog version ${releases[0]?.version ?? "<missing>"} does not match package.json ${packageVersion}`,
    );
  }

  const seenVersions = new Set<string>();
  for (const [index, release] of releases.entries()) {
    if (!SEMVER.test(release.version)) {
      errors.push(`line ${release.line}: ${release.version} is not a stable SemVer version`);
      continue;
    }
    if (seenVersions.has(release.version)) {
      errors.push(`line ${release.line}: duplicate version heading ${release.version}`);
    }
    seenVersions.add(release.version);

    if (!release.date || !validDate(release.date)) {
      errors.push(`line ${release.line}: ${release.version} is missing a valid YYYY-MM-DD date`);
    }

    const previous = releases[index - 1];
    if (previous && compareVersions(previous.version, release.version) <= 0) {
      errors.push(
        `line ${release.line}: versions are not strictly descending (${previous.version}, ${release.version})`,
      );
    }
    if (previous?.date && release.date && previous.date < release.date) {
      errors.push(
        `line ${release.line}: release date ${release.date} is newer than ${previous.version} (${previous.date})`,
      );
    }

    const next = releases[index + 1];
    if (release.link?.includes("/compare/") && next) {
      const expectedSuffix = `/compare/v${next.version}...v${release.version}`;
      if (!release.link.endsWith(expectedSuffix)) {
        errors.push(
          `line ${release.line}: compare link must end with ${expectedSuffix}, got ${release.link}`,
        );
      }
    } else if (release.link?.includes("/releases/tag/")) {
      if (!release.link.endsWith(`/releases/tag/v${release.version}`)) {
        errors.push(`line ${release.line}: release link does not match ${release.version}`);
      }
    } else if (next) {
      errors.push(`line ${release.line}: ${release.version} is missing a compare or release link`);
    }
  }

  for (const tag of options.tags ?? []) {
    const version = normalizeVersion(tag);
    if (SEMVER.test(version) && !seenVersions.has(version)) {
      errors.push(`published tag ${tag} has no CHANGELOG.md section`);
    }
  }

  if (options.releaseTag) {
    const releaseVersion = normalizeVersion(options.releaseTag);
    if (releaseVersion !== packageVersion) {
      errors.push(
        `release tag ${options.releaseTag} does not match package.json version ${packageVersion}`,
      );
    }
    if (releaseVersion !== releases[0]?.version) {
      errors.push(
        `release tag ${options.releaseTag} does not match first changelog version ${releases[0]?.version ?? "<missing>"}`,
      );
    }
  }

  errors.push(...duplicateGeneratedEntries(changelog));
  return errors;
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function changelogChanged(baseRef: string): boolean {
  const result = spawnSync("git", ["diff", "--quiet", `${baseRef}...HEAD`, "--", "CHANGELOG.md"]);
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error(
    result.stderr.toString() || `git diff exited ${result.status ?? "without status"}`,
  );
}

function auditPullRequestOwnership(
  baseRef: string,
  pullRequestTitle: string | undefined,
  currentPackageVersion: string,
  tags: string[],
): string[] {
  if (!changelogChanged(baseRef)) return [];

  const baseChangelog = gitOutput(["show", `${baseRef}:CHANGELOG.md`]);
  const basePackage = JSON.parse(gitOutput(["show", `${baseRef}:package.json`])) as {
    version?: string;
  };
  const baseVersion = basePackage.version ?? "";
  const baseErrors = auditChangelog(baseChangelog, baseVersion, { tags });
  if (baseErrors.length > 0) {
    console.error("changelog: base branch already has drift; allowing this repair pull request");
    return [];
  }

  const errors: string[] = [];
  if (baseVersion === currentPackageVersion) {
    errors.push(
      "CHANGELOG.md changed without a package version bump; only Release Please may update it",
    );
  }
  const expectedTitle = `chore(main): release ${currentPackageVersion}`;
  if (pullRequestTitle !== expectedTitle) {
    errors.push(
      `CHANGELOG.md changed outside a Release Please PR (expected title: ${expectedTitle})`,
    );
  }
  return errors;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version?: string;
  };
  const packageVersion = packageJson.version ?? "";
  const tags = gitOutput(["tag", "--list", "v[0-9]*"]).split("\n").filter(Boolean);
  const releaseTag = argumentValue("--release-tag");
  const baseRef = argumentValue("--base-ref");
  const pullRequestTitle = argumentValue("--pr-title");

  const errors = auditChangelog(changelog, packageVersion, { tags, releaseTag });
  if (baseRef) {
    errors.push(...auditPullRequestOwnership(baseRef, pullRequestTitle, packageVersion, tags));
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`changelog: ${error}`);
    process.exit(1);
  }
  console.error(
    `changelog: ${packageVersion} matches ${tags.length} published tags and repository policy`,
  );
}

if (import.meta.main) main();
