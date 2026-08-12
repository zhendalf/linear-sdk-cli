/**
 * Per-invocation context: resolved config, lazily-created client, and the
 * Output sink. Built once from the root program's global options and threaded
 * into every command action.
 */

import type { LinearClient } from "@linear/sdk";
import { resolveConfig, type ResolvedConfig } from "./config.js";
import { createClient } from "./client.js";
import { Output } from "./output/format.js";

export interface GlobalOptions {
  json?: boolean;
  color?: boolean; // commander sets false for --no-color
  apiKey?: string;
  /** A key, or several — `issue list`/`mine`/`search` make `--team` repeatable. */
  team?: string | string[];
  workspace?: string;
  limit?: number;
  all?: boolean;
  fields?: string[];
  yes?: boolean;
  quiet?: boolean;
  debug?: boolean;
  noInput?: boolean;
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
      flags: { apiKey: options.apiKey, team: firstTeam(options.team), workspace: options.workspace },
    });
    const color =
      options.color !== false && options.json !== true && process.stdout.isTTY === true;
    this.isTTY = process.stdin.isTTY === true && !options.noInput;
    this.output = new Output({
      json: options.json === true,
      color,
      quiet: options.quiet === true,
      debug: options.debug === true,
      fields: options.fields,
    });
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
