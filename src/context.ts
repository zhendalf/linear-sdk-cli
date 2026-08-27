/**
 * Per-invocation context: resolved config, lazily-created client, and the
 * Output sink. Built once from the root program's global options and threaded
 * into every command action.
 */

import type { LinearClient } from "@linear/sdk";
import { resolveConfig, type ResolvedConfig } from "./config.js";
import { createClient, setRetryReporter } from "./client.js";
import { Output } from "./output/format.js";
import { isDebugEnabled, shouldUseColor } from "./output/color.js";

/**
 * The globals as the parser actually stores them.
 *
 * This interface used to declare `noInput` while commander stored `input:
 * false` — the field was never written by anything, stayed `undefined` forever,
 * and the prompt guard built on it never fired. The two agree now because the
 * flags are registered as plain booleans (`NoFlagOption` in lib/options.ts)
 * whose keys we choose, rather than as commander negations whose keys we only
 * assumed. `test/unit/options.test.ts` pins the keys against a real parse, so
 * the type cannot quietly go back to describing a parser that does not exist.
 */
export interface GlobalOptions {
  json?: boolean;
  /** `--no-ansi`, or its alias `--no-color`. Present (true) only when passed. */
  noAnsi?: boolean;
  /** `--no-input`. Present (true) only when passed. */
  noInput?: boolean;
  apiKey?: string;
  accessToken?: string;
  /** A key, or several — `issue list`/`mine`/`search` make `--team` repeatable. */
  team?: string | string[];
  workspace?: string;
  limit?: number;
  all?: boolean;
  fields?: string[];
  yes?: boolean;
  quiet?: boolean;
  debug?: boolean;
}

/** `--team` may arrive repeated (issue queries); single-team consumers take the first. */
export function firstTeam(team: string | string[] | undefined): string | undefined {
  return Array.isArray(team) ? team[0] : team;
}

export class Context {
  readonly config: ResolvedConfig;
  readonly output: Output;
  readonly options: GlobalOptions;
  readonly isTTY: boolean;
  private _client?: LinearClient;

  constructor(options: GlobalOptions) {
    this.options = options;
    this.config = resolveConfig({
      // The issue queries accept `--team` several times; everything downstream
      // of the config (the default team for creates, cycle lookups, …) is
      // single-valued, so those commands read the full list off their own opts
      // and the config sees the first key.
      flags: {
        apiKey: options.apiKey,
        accessToken: options.accessToken,
        team: firstTeam(options.team),
        workspace: options.workspace,
      },
    });
    const color = shouldUseColor({
      disabled: options.noAnsi,
      json: options.json,
      isTTY: process.stdout.isTTY === true,
    });
    // Four independent reasons not to prompt, and any one of them is enough.
    // The first two are the user saying so; the last two are the situation
    // saying so. `--json` counts because JSON is what a script or an agent
    // asks for, and a prompt inside a pipeline is a hang, not a question —
    // there is no one at the other end to answer it. Non-TTY stdout counts for
    // the same reason: inquirer draws on stdout, so a redirect would send the
    // question into the file the caller is collecting.
    this.isTTY =
      options.noInput !== true &&
      options.json !== true &&
      process.stdin.isTTY === true &&
      process.stdout.isTTY === true;
    this.output = new Output({
      json: options.json === true,
      color,
      quiet: options.quiet === true,
      debug: isDebugEnabled(options.debug),
      fields: options.fields,
      isTTY: process.stdout.isTTY === true,
    });
    // Rate-limit waits are status, so they go through the same sink as every
    // other status line: stderr, silenced by --quiet, never on JSON stdout.
    setRetryReporter((line) => this.output.info(line));
  }

  /** Lazily construct the Linear client (so `--help` never needs a key). */
  get client(): LinearClient {
    if (!this._client) this._client = createClient(this.config);
    return this._client;
  }

  /** Default team key from flags/config (used when a command omits --team). */
  get defaultTeam(): string | undefined {
    return firstTeam(this.options.team) ?? this.config.team;
  }

  /**
   * Resolve the effective page limit. `--all` means exhaust (Infinity), and so
   * does `--limit 0` — the reference CLI's spelling for "no limit", accepted
   * here so a transplanted script does not silently get the 50-row default.
   */
  get limit(): number {
    if (this.options.all || this.options.limit === 0) return Infinity;
    return this.options.limit && this.options.limit > 0 ? this.options.limit : 50;
  }
}
