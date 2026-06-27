# linear project

> Work with projects

Group alias: `p`

_Generated from `linear commands --json`. `linear project --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

### `linear project`

Work with projects

Aliases: `p`

```
linear project [options]
```

### `linear project archive`

Archive a project

```
linear project archive [options] <id>
```

### `linear project create`

Create a new project

Aliases: `new`

```
linear project create [options]
```

| Option                      | Description                                |
| --------------------------- | ------------------------------------------ |
| `--name <name>`             | project name                               |
| `-d, --description <text>`  | project description                        |
| `--description-file <path>` | read description from a file ('-' = stdin) |
| `--teams <key>`             | team (repeatable / comma-separated)        |
| `--lead <who>`              | project lead (me\|email\|name\|id)         |
| `--state <name>`            | initial status (name, type, or id)         |
| `--start <date>`            | planned start date (YYYY-MM-DD)            |
| `--target <date>`           | planned target date (YYYY-MM-DD)           |

### `linear project list`

List projects with filters

Aliases: `ls`

```
linear project list [options]
```

| Option           | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `--state <name>` | filter by project state/status (e.g. started, completed) |

### `linear project milestones`

List a project's milestones

```
linear project milestones [options] <id>
```

### `linear project update`

Update a project

Aliases: `edit`

```
linear project update [options] <id>
```

| Option                      | Description                                |
| --------------------------- | ------------------------------------------ |
| `--name <name>`             | new name                                   |
| `-d, --description <text>`  | new description                            |
| `--description-file <path>` | read description from a file ('-' = stdin) |
| `--teams <key>`             | set teams (repeatable / comma-separated)   |
| `--lead <who>`              | project lead (me\|email\|name\|id)         |
| `--state <name>`            | status (name, type, or id)                 |
| `--start <date>`            | planned start date (YYYY-MM-DD)            |
| `--target <date>`           | planned target date (YYYY-MM-DD)           |

### `linear project view`

Show a project (by name or id)

Aliases: `show`

```
linear project view [options] <id>
```
