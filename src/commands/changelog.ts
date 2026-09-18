/** Show release notes from the CHANGELOG.md bundled with the CLI package. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { action } from "../lib/action.js";
import { CliError } from "../lib/errors.js";
import type { Context } from "../context.js";

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  url: string;
  sections: ChangelogSection[];
}

const CHANGELOG_PATH = fileURLToPath(new URL("../../CHANGELOG.md", import.meta.url));
const DEFAULT_RELEASE_COUNT = 3;

/** Parse the Release Please Markdown format into a stable machine-readable shape. */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  const releasePattern = /^## \[([^\]]+)]\(([^)]+)\) \((\d{4}-\d{2}-\d{2})\)\s*$/gm;
  const matches = [...markdown.matchAll(releasePattern)];

  for (const [index, match] of matches.entries()) {
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(bodyStart, bodyEnd);
    const sections: ChangelogSection[] = [];
    const sectionPattern = /^### (.+)\s*$/gm;
    const sectionMatches = [...body.matchAll(sectionPattern)];

    for (const [sectionIndex, sectionMatch] of sectionMatches.entries()) {
      const itemsStart = (sectionMatch.index ?? 0) + sectionMatch[0].length;
      const itemsEnd = sectionMatches[sectionIndex + 1]?.index ?? body.length;
      const itemsBody = body.slice(itemsStart, itemsEnd).trim();
      const items = itemsBody
        .split(/\n(?=- )/)
        .map((item) => item.replace(/^- /, "").replace(/\n\s+/g, " ").trim())
        .filter(Boolean);
      sections.push({ title: sectionMatch[1]!.trim(), items });
    }

    releases.push({
      version: match[1]!,
      url: match[2]!,
      date: match[3]!,
      sections,
    });
  }

  return releases;
}

export function registerChangelog(program: Command): void {
  program
    .command("changelog")
    .description("Show recent CLI release notes")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  linear changelog                 # latest three releases",
        "  linear changelog --limit 1       # latest release only",
        "  linear changelog --all           # complete bundled history",
        "  linear changelog --json          # structured release notes",
      ].join("\n"),
    )
    .action(action(runChangelog));
}

export function runChangelog(ctx: Context): void {
  let markdown: string;
  try {
    markdown = readFileSync(CHANGELOG_PATH, "utf8");
  } catch (error) {
    throw new CliError(`Cannot read the bundled changelog: ${(error as Error).message}`, "runtime");
  }

  const releases = parseChangelog(markdown);
  const count =
    ctx.options.all || ctx.options.limit === 0
      ? releases.length
      : (ctx.options.limit ?? DEFAULT_RELEASE_COUNT);
  const recent = releases.slice(0, count);

  ctx.output.emit(recent, () => {
    const rendered = recent
      .map((release) => {
        const sections = release.sections
          .map(
            (section) =>
              `### ${section.title}\n\n${section.items.map((item) => `- ${item}`).join("\n")}`,
          )
          .join("\n\n");
        return `## [${release.version}](${release.url}) (${release.date})\n\n${sections}`;
      })
      .join("\n\n");
    ctx.output.markdown(rendered);
  });
}
