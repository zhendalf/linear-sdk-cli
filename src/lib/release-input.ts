/** Parsing shared by the release command groups; API behavior stays in services. */
import { Command, Option } from "commander";
import { resolveBody } from "./body.js";
import { usageError } from "./errors.js";
import type { LifecycleInput, ReleaseInput, NoteInput, LinkInput } from "../services/release.js";

export const PIPELINE_TYPES = ["scheduled", "continuous"];
export const STAGE_TYPES = ["planned", "started", "completed", "canceled"];
export const repeat = (value: string, previous: string[] = []): string[] => [...previous, value];

export function booleanValue(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw usageError("Expected true or false.");
}
export function finiteNumber(value: string): number {
  if (!value.trim() || !Number.isFinite(Number(value)))
    throw usageError("Expected a finite number.");
  return Number(value);
}

export function descriptionOptions(command: Command): Command {
  return command
    .addOption(
      new Option("--description <text>", "release description (Markdown)").conflicts([
        "descriptionFile",
        "clearDescription",
      ]),
    )
    .addOption(
      new Option(
        "--description-file <path>",
        "read description from file ('-' for stdin)",
      ).conflicts(["description", "clearDescription"]),
    )
    .addOption(
      new Option("--clear-description", "clear the description").conflicts([
        "description",
        "descriptionFile",
      ]),
    );
}
export function releaseInput(opts: Record<string, any>): ReleaseInput {
  return {
    name: opts.name,
    version: opts.releaseVersion,
    commitSha: opts.commitSha,
    stageId: opts.stage,
    startDate: opts.startDate,
    targetDate: opts.targetDate,
    description: description(opts),
  };
}
function description(opts: Record<string, any>): string | null | undefined {
  return opts.clearDescription
    ? null
    : resolveBody({ arg: opts.description, file: opts.descriptionFile, interactive: false });
}
export function lifecycleOptions(command: Command): Command {
  return descriptionOptions(command)
    .requiredOption("--pipeline <id|slug>", "target pipeline UUID or slug")
    .requiredOption(
      "--release-version <version>",
      "explicit release version within the pipeline (no latest fallback)",
    )
    .option("--name <name>", "release name")
    .option("--link <label=url|url>", "attach an external link (repeatable)", repeat);
}
export function lifecycleInput(opts: Record<string, any>): LifecycleInput {
  return {
    name: opts.name,
    description: description(opts),
    links: opts.link?.map(parseReleaseLink),
  };
}
export function parseReleaseLink(value: string): LinkInput {
  // Bare URLs may contain '=' in their query string; do not split those.
  const bare = /^https?:\/\//i.test(value);
  const index = value.indexOf("=");
  const url = bare || index < 0 ? value : value.slice(index + 1);
  const label = bare || index < 0 ? undefined : value.slice(0, index);
  try {
    const parsed = new URL(url);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      label === ""
    )
      throw new Error();
  } catch {
    throw usageError("--link requires an HTTP(S) URL or Label=URL, without embedded credentials.");
  }
  return { url, ...(label === undefined ? {} : { label }) };
}
export function issueReferences(values: string[] | undefined, commitSha: string) {
  return values?.map((value) => {
    const [identifier, sha = commitSha, ...rest] = value.split("=");
    if (
      !/^[a-z][a-z\d]*-\d+$/i.test(identifier ?? "") ||
      rest.length ||
      !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(sha)
    ) {
      throw usageError("--issue/--reverted-issue requires KEY-123 or KEY-123=FULL_SHA.");
    }
    return { identifier: identifier!.toUpperCase(), commitSha: sha };
  });
}
export function noteOptions(command: Command): Command {
  return command
    .option("--title <title>", "release note title")
    .addOption(new Option("--body <text>", "release note body (Markdown)").conflicts("bodyFile"))
    .addOption(
      new Option("--body-file <path>", "read Markdown from file ('-' for stdin)").conflicts("body"),
    )
    .addOption(
      new Option("--release <id>", "covered release UUID or slug (repeatable)")
        .argParser(repeat)
        .conflicts(["fromRelease", "toRelease"]),
    )
    .addOption(
      new Option("--from-release <id>", "oldest release in an inclusive createdAt range").conflicts(
        "release",
      ),
    )
    .addOption(
      new Option("--to-release <id>", "newest release in the inclusive range").conflicts("release"),
    );
}
export function noteInput(opts: Record<string, any>): NoteInput {
  return {
    title: opts.title,
    content: resolveBody({ arg: opts.body, file: opts.bodyFile, interactive: false }),
    releaseIds: opts.release,
    rangeFromReleaseId: opts.fromRelease,
    rangeToReleaseId: opts.toRelease,
  };
}
