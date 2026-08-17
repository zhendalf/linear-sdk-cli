# linear commands

> List every command in a machine-readable tree, or describe one (for scripts/agents)

_Generated from `linear commands --json`. `linear commands --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear commands`

List every command in a machine-readable tree, or describe one (for scripts/agents)

```
linear commands [options] [path...]
```

**Output (`--json`)**: a bare array of objects — `output` is absent on a group that only holds subcommands

```text
path: string
description: string
aliases: string[]
arguments: Array<{name: string, required: boolean, variadic: boolean}>
options: Array<{flags: string, description: string}>
output?: {kind: string, fields?: object, note?: string, variants?: object}
```

With `[path]`: a bare object

```text
path: string
description: string
aliases: string[]
arguments: Array<{name: string, required: boolean, variadic: boolean}>
options: Array<{flags: string, description: string}>
output?: {kind: string, fields?: object, note?: string, variants?: object}
```
