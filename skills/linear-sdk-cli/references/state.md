# linear state

> Inspect workflow states

Group alias: `st`

_Generated from `linear commands --json`. `linear state --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear state`

Inspect workflow states

Aliases: `st`

```
linear state [options]
```

### `linear state list`

List a team's workflow states (defaults to the configured team)

Aliases: `ls`

```
linear state list [options] [team]
```

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
type: string
position: number
color: string
```

### `linear state view`

Show a workflow state (by id, or by name/type within --team / the default team)

```
linear state view [options] <id>
```

**Output (`--json`)**: a bare object

```text
id: string
name: string
type: string
position: number
color: string
description: string | null
team: string | null
createdAt: string
updatedAt: string
```
