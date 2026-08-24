#!/usr/bin/env bun

/**
 * Regenerate the linear-sdk-cli skill docs from the CLI's own machine-readable
 * command tree (`linear commands --json`).
 *
 * Produces, idempotently:
 *   - skills/linear-sdk-cli/references/<group>.md  — one per top-level group
 *   - the generated command list inside SKILL.md, between the markers
 *       <!-- BEGIN GENERATED COMMANDS --> / <!-- END GENERATED COMMANDS -->
 *
 * The CLI is resolved as `src/bin/linear.ts` under the repo root (run via Bun),
 * falling back to a `linear` binary on PATH. Override with LINEAR_CLI, e.g.
 *   LINEAR_CLI="linear" bun run skills/linear-sdk-cli/scripts/generate-docs.ts
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// The one renderer for a shape, shared with `linear commands <path>` so the
// reference and the CLI spell a row the same way.
import { renderShape, variantDelta, type OutputShape } from "../../../src/lib/shape.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(SCRIPT_DIR, "..");
const REFERENCES_DIR = join(SKILL_DIR, "references");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");
const REPO_ROOT = join(SKILL_DIR, "..", "..");

const BEGIN_MARKER = "<!-- BEGIN GENERATED COMMANDS -->";
const END_MARKER = "<!-- END GENERATED COMMANDS -->";

interface CliArgument {
  name: string;
  required: boolean;
  variadic: boolean;
}

interface CliOption {
  flags: string;
  description: string;
}

interface CliCommand {
  path: string;
  description: string;
  aliases: string[];
  arguments: CliArgument[];
  options: CliOption[];
  /** What the command prints under `--json` (TES-610); absent on a bare group. */
  output?: OutputShape;
}

/**
 * Options shared by (almost) every command. We collapse them into a single note
 * per reference file instead of repeating ~15 rows under each subcommand.
 *
 * Keyed by flags AND description, because a command may redefine a global with a
 * meaning of its own — `--team` filters (repeatably) on the issue queries and
 * *moves the issue* on `issue update`. Those rows must survive the collapse;
 * matching on the flag string alone would hide exactly the ones worth reading.
 */
const GLOBAL_OPTIONS = new Map([
  ["-j, --json", "output machine-readable JSON"],
  ["--no-ansi", "disable colored output"],
  ["--api-key <key>", "Linear API key (overrides env/config)"],
  ["--workspace <slug>", "select workspace credential profile"],
  ["-t, --team <key>", "default team key (e.g. TES)"],
  ["-n, --limit <n>", "max results (positive integer; 0 = all)"],
  ["--all", "fetch all results (exhaust pagination)"],
  [
    "-f, --fields <a,b,c>",
    "select fields: table columns or detail lines (human), top-level keys (--json)",
  ],
  ["-y, --yes", "skip confirmation prompts"],
  ["-q, --quiet", "suppress status output"],
  ["--no-input", "never prompt; fail instead"],
  ["--debug", "verbose errors (stack traces, raw GraphQL)"],
]);

const isGlobal = (opt: CliOption): boolean => GLOBAL_OPTIONS.get(opt.flags) === opt.description;

function resolveCli(): string[] {
  const fromEnv = process.env.LINEAR_CLI?.trim();
  if (fromEnv) return fromEnv.split(/\s+/);
  const local = join(REPO_ROOT, "src", "bin", "linear.ts");
  if (existsSync(local)) return ["bun", "run", local];
  return ["linear"];
}

function loadCommands(): CliCommand[] {
  const [bin, ...rest] = resolveCli();
  const result = spawnSync(bin, [...rest, "commands", "--json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.status !== 0) {
    const detail = result.stderr || result.error?.message || "unknown error";
    throw new Error(`\`linear commands --json\` failed: ${detail}`);
  }
  const parsed = JSON.parse(result.stdout) as CliCommand[];
  return parsed.sort((a, b) => a.path.localeCompare(b.path));
}

/** The top-level group name for a command path ("issue create" -> "issue"). */
function groupOf(path: string): string {
  return path.split(" ")[0]!;
}

function usageLine(cmd: CliCommand): string {
  const parts = ["linear", cmd.path];
  if (cmd.options.length > 0) parts.push("[options]");
  for (const arg of cmd.arguments) {
    const inner = arg.variadic ? `${arg.name}...` : arg.name;
    parts.push(arg.required ? `<${inner}>` : `[${inner}]`);
  }
  return parts.join(" ");
}

function formatCommand(cmd: CliCommand): string {
  const lines: string[] = [];
  lines.push(`### \`linear ${cmd.path}\``);
  lines.push("");
  if (cmd.description) {
    lines.push(cmd.description);
    lines.push("");
  }
  if (cmd.aliases.length > 0) {
    lines.push(`Aliases: ${cmd.aliases.map((a) => `\`${a}\``).join(", ")}`);
    lines.push("");
  }
  lines.push("```");
  lines.push(usageLine(cmd));
  lines.push("```");
  lines.push("");

  const localOptions = cmd.options.filter((o) => !isGlobal(o));
  if (localOptions.length > 0) {
    lines.push("| Option | Description |");
    lines.push("| --- | --- |");
    for (const opt of localOptions) {
      lines.push(`| \`${escapePipes(opt.flags)}\` | ${escapePipes(opt.description)} |`);
    }
    lines.push("");
  }

  if (cmd.output) lines.push(...formatOutput(cmd.output));

  return lines.join("\n");
}

/** `array of objects` / `object` / `receipt` / `raw` / `none`, as prose. */
function kindLabel(out: OutputShape): string {
  switch (out.kind) {
    case "list":
      return "a bare array of objects";
    case "object":
      return "a bare object";
    case "receipt":
      return "a receipt object";
    case "raw":
      return "raw JSON (keys depend on the request)";
    default:
      return "none — never prints JSON";
  }
}

/**
 * The `--json` output block of a command reference: what kind of value, then
 * one `key: type` line per field in a text fence, then any variant the same
 * way. Rendered with the CLI's own `renderShape`, so `linear commands <path>`
 * and the reference agree to the character.
 */
function formatOutput(out: OutputShape, heading = "**Output (`--json`)**"): string[] {
  const lines: string[] = [];
  lines.push(`${heading}: ${kindLabel(out)}${out.note ? ` — ${out.note}` : ""}`);
  lines.push("");
  const fields = Object.entries(out.fields ?? {});
  if (fields.length > 0) {
    lines.push("```text");
    for (const [key, shape] of fields) lines.push(`${key}: ${renderShape(shape)}`);
    lines.push("```");
    lines.push("");
  }
  for (const [when, variant] of Object.entries(out.variants ?? {})) {
    const delta = variantDelta(out, variant);
    if (delta) {
      // The base plus a few keys: say only what changes.
      const drop = delta.dropped.length ? `, without \`${delta.dropped.join("`, `")}\`` : "";
      lines.push(`With \`${when}\`: the same${drop}, plus:`);
      lines.push("");
      lines.push("```text");
      for (const [key, shape] of Object.entries(delta.added))
        lines.push(`${key}: ${renderShape(shape)}`);
      lines.push("```");
      lines.push("");
      continue;
    }
    lines.push(...formatOutput(variant, `With \`${when}\``));
  }
  return lines;
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function buildReference(group: string, commands: CliCommand[]): string {
  const root = commands.find((c) => c.path === group);
  const lines: string[] = [];
  lines.push(`# linear ${group}`);
  lines.push("");
  if (root?.description) {
    lines.push(`> ${root.description}`);
    lines.push("");
  }
  if (root && root.aliases.length > 0) {
    lines.push(`Group alias: ${root.aliases.map((a) => `\`${a}\``).join(", ")}`);
    lines.push("");
  }
  lines.push(
    "_Generated from `linear commands --json`. `linear " +
      group +
      " --help` (or `<subcommand> --help`) is authoritative._",
  );
  lines.push("");
  lines.push(
    "Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, " +
      "`-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, " +
      "`-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), " +
      "and `--debug`. " +
      "Only command-specific options are listed below.",
  );
  lines.push("");

  for (const cmd of commands) {
    lines.push(formatCommand(cmd));
  }

  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

function buildCommandList(commands: CliCommand[]): string {
  const groups = new Map<string, CliCommand[]>();
  for (const cmd of commands) {
    const g = groupOf(cmd.path);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(cmd);
  }

  const blocks: string[] = [];
  for (const [, cmds] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    blocks.push(cmds.map((c) => `linear ${c.path}`).join("\n"));
  }
  return blocks.join("\n\n");
}

async function writeReferences(commands: CliCommand[]): Promise<string[]> {
  await mkdir(REFERENCES_DIR, { recursive: true });

  // Remove previously generated reference files so renamed/removed groups don't linger.
  try {
    for (const entry of await readdir(REFERENCES_DIR)) {
      if (entry.endsWith(".md")) await rm(join(REFERENCES_DIR, entry));
    }
  } catch {
    // directory was just created; nothing to clean
  }

  const groups = [...new Set(commands.map((c) => groupOf(c.path)))].sort();
  for (const group of groups) {
    const groupCommands = commands.filter((c) => groupOf(c.path) === group);
    const filepath = join(REFERENCES_DIR, `${group}.md`);
    await writeFile(filepath, buildReference(group, groupCommands), "utf8");
  }
  return groups;
}

async function updateSkillMd(commands: CliCommand[], groups: string[]): Promise<void> {
  const current = await readFile(SKILL_MD, "utf8");

  const begin = current.indexOf(BEGIN_MARKER);
  const end = current.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`Could not find generated-commands markers in ${SKILL_MD}`);
  }

  const before = current.slice(0, begin + BEGIN_MARKER.length);
  const after = current.slice(end);
  // Format chosen to match Oxfmt: no blank line after the opening marker,
  // one blank line before the closing marker, so re-running stays a no-op.
  const block = ["", "```text", buildCommandList(commands), "```", "", ""].join("\n");
  const next = `${before}${block}${after}`;

  await writeFile(SKILL_MD, next, "utf8");

  // Sanity check that every group has a reference link (warn only; non-fatal).
  for (const group of groups) {
    if (!next.includes(`references/${group}.md`)) {
      console.warn(`Warning: SKILL.md has no link to references/${group}.md`);
    }
  }
}

/**
 * Run Oxfmt over the generated markdown so the output matches the repo's
 * formatting (table alignment, list spacing) and re-running stays a clean no-op.
 * Best-effort: if Oxfmt isn't available the docs are still valid markdown.
 */
function formatGenerated(): void {
  const result = spawnSync("bunx", ["oxfmt", "."], {
    stdio: "inherit",
    cwd: SKILL_DIR,
  });
  if (result.status !== 0) {
    console.warn("Warning: Oxfmt formatting step skipped (non-zero exit).");
  }
}

async function main(): Promise<void> {
  const commands = loadCommands();
  const groups = await writeReferences(commands);
  await updateSkillMd(commands, groups);
  formatGenerated();
  console.log(
    `Generated ${groups.length} reference files (${commands.length} commands) and refreshed SKILL.md.`,
  );
}

await main();
