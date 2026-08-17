# linear initiative

> Work with initiatives

Group alias: `init`

_Generated from `linear commands --json`. `linear initiative --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear initiative`

Work with initiatives

Aliases: `init`

```
linear initiative [options]
```

**Output (`--json`)**: a bare object — runs `initiative view` by default

```text
id: string
name: string
description: string | null
status: string | null
priority: number
priorityLabel: string
labels: string[]
health: string | null
targetDate: string | null
color: string | null
icon: string | null
url: string
createdAt: string
updatedAt: string
startedAt: string | null
completedAt: string | null
archivedAt: string | null
owner: string | null
creator: string | null
projects: Array<{id: string, name: string, status: {name: string, type: string} | null}>
```

### `linear initiative add-project`

Link a project to an initiative

```
linear initiative add-project [options] <initiative> <project>
```

| Option             | Description                              |
| ------------------ | ---------------------------------------- |
| `--sort-order <n>` | position among the initiative's projects |

**Output (`--json`)**: a receipt object

```text
id: string
initiative: {id: string, name: string}
project: {id: string, name: string}
```

### `linear initiative archive`

Archive an initiative

```
linear initiative archive [options] <id>
```

**Output (`--json`)**: a receipt object

```text
id: string
name: string
archived: boolean
```

### `linear initiative create`

Create a new initiative

Aliases: `new`

```
linear initiative create [options]
```

| Option                      | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `--name <name>`             | initiative name                                         |
| `-d, --description <text>`  | initiative description                                  |
| `--description-file <path>` | read description from a file ('-' = stdin)              |
| `--target <date>`           | estimated completion date (YYYY-MM-DD)                  |
| `--owner <who>`             | initiative owner (me\|email\|name\|id)                  |
| `--status <name>`           | status (Planned, Active, Completed, Canceled, Proposed) |
| `-P, --priority <0-4>`      | priority (0 none, 1 urgent … 4 low)                     |
| `-l, --label <name>`        | initiative label (repeatable / comma-separated)         |
| `--icon <name>`             | Linear icon name, capitalized (e.g. Rocket)             |
| `--color <hex>`             | initiative color (e.g. #5E6AD2)                         |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
url: string
```

### `linear initiative delete`

Delete (trash) an initiative

Aliases: `rm`

```
linear initiative delete [options] <id>
```

**Output (`--json`)**: a receipt object

```text
id: string
name: string
deleted: boolean
```

### `linear initiative list`

List workspace initiatives (every status unless --status narrows)

Aliases: `ls`

```
linear initiative list [options]
```

| Option            | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `--status <name>` | filter by status (Planned, Active, Completed, Canceled, Proposed) |
| `--owner <who>`   | filter by owner (me\|email\|name\|id)                             |
| `--archived`      | include archived initiatives                                      |

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
status: string | null
priority: number
targetDate: string | null
health: string | null
url: string
```

### `linear initiative remove-project`

Unlink a project from an initiative

```
linear initiative remove-project [options] <initiative> <project>
```

**Output (`--json`)**: a receipt object

```text
id: string
initiative: {id: string, name: string}
project: {id: string, name: string}
removed: boolean
```

### `linear initiative unarchive`

Unarchive an initiative

```
linear initiative unarchive [options] <id>
```

**Output (`--json`)**: a receipt object

```text
id: string
name: string
archived: boolean
```

### `linear initiative update`

Update an initiative

Aliases: `edit`

```
linear initiative update [options] <id>
```

| Option                      | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `--name <name>`             | new name                                                |
| `-d, --description <text>`  | new description                                         |
| `--description-file <path>` | read description from a file ('-' = stdin)              |
| `--target <date>`           | estimated completion date (YYYY-MM-DD)                  |
| `--owner <who>`             | initiative owner (me\|email\|name\|id)                  |
| `--status <name>`           | status (Planned, Active, Completed, Canceled, Proposed) |
| `-P, --priority <0-4>`      | priority (0 none, 1 urgent … 4 low)                     |
| `-l, --label <name>`        | replace the labels (repeatable / comma-separated)       |
| `--icon <name>`             | Linear icon name, capitalized (e.g. Rocket)             |
| `--color <hex>`             | initiative color (e.g. #5E6AD2)                         |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
url: string
```

### `linear initiative view`

Show an initiative (by name or id)

Aliases: `show`

```
linear initiative view [options] <id>
```

**Output (`--json`)**: a bare object

```text
id: string
name: string
description: string | null
status: string | null
priority: number
priorityLabel: string
labels: string[]
health: string | null
targetDate: string | null
color: string | null
icon: string | null
url: string
createdAt: string
updatedAt: string
startedAt: string | null
completedAt: string | null
archivedAt: string | null
owner: string | null
creator: string | null
projects: Array<{id: string, name: string, status: {name: string, type: string} | null}>
```
