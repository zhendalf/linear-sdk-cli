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
  team?: string;
  limit?: number;
  all?: boolean;
  fields?: string[];
  yes?: boolean;
  quiet?: boolean;
  debug?: boolean;
  noInput?: boolean;
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
      flags: { apiKey: options.apiKey, team: options.team },
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
    return this.options.team ?? this.config.team;
  }

  /** Resolve the effective page limit. `--all` means exhaust (Infinity). */
  get limit(): number {
    if (this.options.all) return Infinity;
    return this.options.limit && this.options.limit > 0 ? this.options.limit : 50;
  }
}
