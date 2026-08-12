# linear cycle

> Work with cycles

Group alias: `c`

_Generated from `linear commands --json`. `linear cycle --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

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

### `linear cycle current`

Show the team's currently active cycle

```
linear cycle current [options] [team]
```

### `linear cycle list`

List cycles for a team (defaults to the configured team)

Aliases: `ls`

```
linear cycle list [options] [team]
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

### `linear cycle view`

Show a cycle (by id, number, or 'current')

```
linear cycle view [options] <id>
```
