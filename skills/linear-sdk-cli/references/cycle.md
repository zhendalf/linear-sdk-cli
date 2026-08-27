# linear cycle

> Work with cycles

Group alias: `c`

_Generated from `linear commands --json`. `linear cycle --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear cycle`

Work with cycles

Aliases: `c`

```
linear cycle [options]
```

### `linear cycle create`

Create a cycle

Aliases: `new`

```
linear cycle create [options] [team]
```

| Option           | Description                            |
| ---------------- | -------------------------------------- |
| `--start <date>` | start date/time (ISO, e.g. 2026-07-01) |
| `--end <date>`   | end date/time (ISO, e.g. 2026-07-14)   |
| `--name <name>`  | custom cycle name                      |

**Output (`--json`)**: a receipt object

```text
id: string
number: number
```

### `linear cycle current`

Show the team's currently active cycle

```
linear cycle current [options] [team]
```

**Output (`--json`)**: a bare object

```text
id: string
number: number
name: string | null
description: string | null
startsAt: string
endsAt: string
completedAt: string | null
progress: number
team: string | null
```

### `linear cycle list`

List cycles for a team (defaults to the configured team)

Aliases: `ls`

```
linear cycle list [options] [team]
```

**Output (`--json`)**: a bare array of objects

```text
id: string
number: number
name: string | null
startsAt: string
endsAt: string
progress: number
completedAt: string | null
```

### `linear cycle update`

Update a cycle (by id, number, or 'current')

Aliases: `edit`

```
linear cycle update [options] <id>
```

| Option           | Description           |
| ---------------- | --------------------- |
| `--name <name>`  | custom cycle name     |
| `--start <date>` | start date/time (ISO) |
| `--end <date>`   | end date/time (ISO)   |

**Output (`--json`)**: a receipt object

```text
id: string
number: number
```

### `linear cycle view`

Show a cycle (by id, number, or 'current')

```
linear cycle view [options] <id>
```

**Output (`--json`)**: a bare object

```text
id: string
number: number
name: string | null
description: string | null
startsAt: string
endsAt: string
completedAt: string | null
progress: number
team: string | null
```
