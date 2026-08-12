# linear project

> Work with projects

Group alias: `p`

_Generated from `linear commands --json`. `linear project --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

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

| Option                      | Description                                   |
| --------------------------- | --------------------------------------------- |
| `--name <name>`             | project name                                  |
| `-d, --description <text>`  | project description (one-line summary)        |
| `--description-file <path>` | read description from a file ('-' = stdin)    |
| `--content <text>`          | project content (markdown body)               |
| `--content-file <path>`     | read content from a file ('-' = stdin)        |
| `--teams <key>`             | team (repeatable / comma-separated)           |
| `--lead <who>`              | project lead (me\|email\|name\|id)            |
| `--member <who>`            | project member (repeatable / comma-separated) |
| `--state <name>`            | initial status (name, type, or id)            |
| `--start <date>`            | planned start date (YYYY-MM-DD)               |
| `--target <date>`           | planned target date (YYYY-MM-DD)              |
| `-P, --priority <0-4>`      | priority (0 none, 1 urgent … 4 low)           |
| `-l, --label <name>`        | project label (repeatable / comma-separated)  |
| `--icon <name>`             | Linear icon name, capitalized (e.g. Rocket)   |
| `--color <hex>`             | project color (e.g. #EB5757)                  |

### `linear project list`

List projects with filters

Aliases: `ls`

```
linear project list [options]
```

| Option           | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `--state <name>` | filter by status name or type (e.g. 'In QA', started) |

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

| Option                      | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `--name <name>`             | new name                                           |
| `-d, --description <text>`  | new description (one-line summary)                 |
| `--description-file <path>` | read description from a file ('-' = stdin)         |
| `--content <text>`          | new content (markdown body)                        |
| `--content-file <path>`     | read content from a file ('-' = stdin)             |
| `--teams <key>`             | set teams (repeatable / comma-separated)           |
| `--lead <who>`              | project lead (me\|email\|name\|id)                 |
| `--member <who>`            | replace the members (repeatable / comma-separated) |
| `--state <name>`            | status (name, type, or id)                         |
| `--start <date>`            | planned start date (YYYY-MM-DD)                    |
| `--target <date>`           | planned target date (YYYY-MM-DD)                   |
| `-P, --priority <0-4>`      | priority (0 none, 1 urgent … 4 low)                |
| `-l, --label <name>`        | replace the labels (repeatable / comma-separated)  |
| `--icon <name>`             | Linear icon name, capitalized (e.g. Rocket)        |
| `--color <hex>`             | project color (e.g. #EB5757)                       |

### `linear project view`

Show a project (by name or id)

Aliases: `show`

```
linear project view [options] <id>
```
