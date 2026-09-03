# linear project

> Work with projects

Group alias: `p`

_Generated from `linear commands --json`. `linear project --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear project`

Work with projects

Aliases: `p`

```
linear project [options]
```

**Output (`--json`)**: a bare object — runs `project view` by default

```text
id: string
name: string
description: string | null
content: string | null
labels: Array<{id: string, name: string}>
state: string | null
status: {id: string, name: string, type: string} | null
health: string | null
progress: number | null
priority: number
priorityLabel: string
url: string
startDate: string | null
targetDate: string | null
createdAt: string
updatedAt: string
completedAt: string | null
archivedAt: string | null
trashed: boolean
lead: {id: string, displayName: string, email: string} | null
teams: Array<{id: string, key: string, name: string}>
members: Array<{id: string, displayName: string, email: string}>
```

### `linear project archive`

Archive a project

```
linear project archive [options] <id>
```

**Output (`--json`)**: a receipt object

```text
id: string
name: string
archived: boolean
```

### `linear project create`

Create a new project

Aliases: `new`

```
linear project create [options]
```

| Option                      | Description                                    |
| --------------------------- | ---------------------------------------------- |
| `--name <name>`             | project name                                   |
| `-d, --description <text>`  | project description (one-line summary)         |
| `--description-file <path>` | read description from a file ('-' = stdin)     |
| `--content <text>`          | project content (markdown body)                |
| `--content-file <path>`     | read content from a file ('-' = stdin)         |
| `--teams <key>`             | team (repeatable / comma-separated)            |
| `-t, --team <key>`          | same as --teams (repeatable / comma-separated) |
| `--lead <who>`              | project lead (me\|email\|name\|id)             |
| `--member <who>`            | project member (repeatable / comma-separated)  |
| `--state <name>`            | initial status (name, type, or id)             |
| `--start <date>`            | planned start date (YYYY-MM-DD)                |
| `--target <date>`           | planned target date (YYYY-MM-DD)               |
| `-P, --priority <0-4>`      | priority (0 none, 1 urgent … 4 low)            |
| `-l, --label <name>`        | project label (repeatable / comma-separated)   |
| `--icon <name>`             | Linear icon name, capitalized (e.g. Rocket)    |
| `--color <hex>`             | project color (e.g. #EB5757)                   |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
url: string
```

### `linear project delete`

Delete (trash) a project — `archive` keeps it, read-only

Aliases: `rm`

```
linear project delete [options] <id>
```

**Output (`--json`)**: a receipt object

```text
id: string
name: string
deleted: boolean
```

### `linear project list`

List projects with filters (the default team's unless --all-teams)

Aliases: `ls`

```
linear project list [options]
```

| Option               | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| `--state <name>`     | filter by status name or type (e.g. 'In QA', started)                |
| `--all-teams`        | every team's projects, ignoring the default team                     |
| `--include-archived` | include archived resources (the API may also return trashed records) |

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
state: string | null
progress: number | null
url: string
startDate: string | null
targetDate: string | null
status: {name: string} | null
lead: {displayName: string} | null
archivedAt: string | null
trashed: boolean
```

### `linear project milestones`

List a project's milestones

```
linear project milestones [options] <id>
```

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
targetDate: string | null
progress: number | null
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

**Output (`--json`)**: a receipt object

```text
id: string
name: string
url: string
```

### `linear project view`

Show a project (by name or id)

Aliases: `show`

```
linear project view [options] <id>
```

**Output (`--json`)**: a bare object

```text
id: string
name: string
description: string | null
content: string | null
labels: Array<{id: string, name: string}>
state: string | null
status: {id: string, name: string, type: string} | null
health: string | null
progress: number | null
priority: number
priorityLabel: string
url: string
startDate: string | null
targetDate: string | null
createdAt: string
updatedAt: string
completedAt: string | null
archivedAt: string | null
trashed: boolean
lead: {id: string, displayName: string, email: string} | null
teams: Array<{id: string, key: string, name: string}>
members: Array<{id: string, displayName: string, email: string}>
```
