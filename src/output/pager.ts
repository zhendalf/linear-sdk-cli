/** Conditional, portable pager support for long human output. */

import { spawnSync } from "node:child_process";
import { displayWidth } from "./sanitize.js";

export interface PagerCommand {
  command: string;
  args: string[];
}

export interface PagerDecision {
  enabled?: boolean;
  json?: boolean;
  isTTY?: boolean;
  rows?: number;
  columns?: number;
}

/** Count terminal rows, including the wrapping a terminal applies to long lines. */
export function terminalLineCount(content: string, columns = 80): number {
  const width = Math.max(1, columns);
  return content.split("\n").reduce((count, line) => {
    return count + Math.max(1, Math.ceil(displayWidth(line) / width));
  }, 0);
}

/** Page only deliberately-enabled, long, interactive human output. */
export function shouldUsePager(content: string, decision: PagerDecision): boolean {
  if (decision.enabled === false || decision.json === true || decision.isTTY !== true) return false;
  const rows = decision.rows && decision.rows > 2 ? decision.rows : 52;
  return terminalLineCount(content, decision.columns ?? 80) > rows - 2;
}

/**
 * Resolve `$PAGER` followed by platform fallbacks. The environment value is a
 * command line, not a shell program: quotes/backslashes are honoured, while
 * expansions and redirections are deliberately not executed.
 */
export function pagerCommands(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): PagerCommand[] {
  const commands: PagerCommand[] = [];
  const configured = env.PAGER?.trim();
  if (configured) {
    const argv = splitCommand(configured);
    if (argv.length) commands.push({ command: argv[0]!, args: argv.slice(1) });
  }

  if (platform === "win32") {
    commands.push({ command: "more.com", args: [] });
  } else {
    // -R passes through our SGR colour, -X leaves the terminal contents visible.
    commands.push({ command: "less", args: ["-R", "-X"] });
    commands.push({ command: "more", args: [] });
  }

  const seen = new Set<string>();
  return commands.filter(({ command, args }) => {
    const key = JSON.stringify([command, args]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface PageOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Test seam; production uses spawnSync without a shell. */
  run?: (candidate: PagerCommand, content: string, env: NodeJS.ProcessEnv) => boolean;
}

/** Try the configured pager and fallbacks. False means the caller should print directly. */
export function pageOutput(content: string, options: PageOptions = {}): boolean {
  const env = options.env ?? process.env;
  const run = options.run ?? runPager;
  for (const candidate of pagerCommands(env, options.platform)) {
    if (run(candidate, content, env)) return true;
  }
  return false;
}

function runPager(candidate: PagerCommand, content: string, env: NodeJS.ProcessEnv): boolean {
  const result = spawnSync(candidate.command, candidate.args, {
    input: content,
    stdio: ["pipe", "inherit", "inherit"],
    env,
  });
  return !result.error && result.status === 0;
}

/** A non-evaluating, shell-like argv splitter for PAGER. */
function splitCommand(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inWord = false;
  let quote: '"' | "'" | undefined;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else current += char;
    } else if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === "\\" && i + 1 < line.length && '"\\'.includes(line[i + 1]!)) {
        current += line[++i];
      } else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
    } else if (char === "\\" && i + 1 < line.length) {
      current += line[++i];
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) out.push(current);
      current = "";
      inWord = false;
    } else {
      current += char;
      inWord = true;
    }
  }

  // A malformed environment setting should not abort an otherwise successful
  // CLI command; ignore it and continue to the portable fallbacks.
  if (quote) return [];
  if (inWord) out.push(current);
  return out;
}
