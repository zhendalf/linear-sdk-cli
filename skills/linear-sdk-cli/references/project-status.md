# linear project-status

> Manage workspace project-status definitions

Group alias: `project-statuses`

_Generated from `linear commands --json`. `linear project-status --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear project-status`

Manage workspace project-status definitions

Aliases: `project-statuses`

```
linear project-status [options]
```

### `linear project-status archive`

Archive a project status (requires no active projects and another status of its type)

```
linear project-status archive [options] <name-or-id>
```

**Output (`--json`)**: a receipt object

```text
id: string
name: string
archived: boolean
```

### `linear project-status create`

Create a workspace project status (explicit because duplicate names are valid)

Aliases: `new`

```
linear project-status create [options]
```

| Option                      | Description                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| `--name <name>`             | status name                                                          |
| `-d, --description <text>`  | status description                                                   |
| `--description-file <path>` | read description from a file ('-' = stdin)                           |
| `--color <hex>`             | six-digit hex color (e.g. #5E6AD2)                                   |
| `--position <number>`       | position within the status type                                      |
| `--type <type>`             | status type (backlog\|planned\|started\|paused\|completed\|canceled) |
| `--indefinite`              | allow projects to remain in this status indefinitely                 |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
type: string
```

### `linear project-status list`

List workspace project statuses

Aliases: `ls`

```
linear project-status list [options]
```

| Option               | Description                       |
| -------------------- | --------------------------------- |
| `--include-archived` | include archived project statuses |

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
description: string | null
color: string
position: number
type: string
indefinite: boolean
archivedAt: string | null
```

### `linear project-status unarchive`

Unarchive a project status by exact name or id

```
linear project-status unarchive [options] <name-or-id>
```

**Output (`--json`)**: a receipt object

```text
id: string
name: string
archived: boolean
```

### `linear project-status update`

Update a project status by exact name or id

Aliases: `edit`

```
linear project-status update [options] <name-or-id>
```

| Option                      | Description                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| `--name <name>`             | new status name                                                      |
| `-d, --description <text>`  | new status description                                               |
| `--description-file <path>` | read description from a file ('-' = stdin)                           |
| `--color <hex>`             | six-digit hex color (e.g. #5E6AD2)                                   |
| `--position <number>`       | position within the status type                                      |
| `--type <type>`             | status type (backlog\|planned\|started\|paused\|completed\|canceled) |
| `--indefinite`              | allow projects to remain in this status indefinitely                 |
| `--no-indefinite`           | do not allow projects to remain indefinitely                         |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
type: string
```

### `linear project-status view`

Show a project status by exact name or id

```
linear project-status view [options] <name-or-id>
```

**Output (`--json`)**: a bare object

```text
id: string
name: string
description: string | null
color: string
position: number
type: string
indefinite: boolean
archivedAt: string | null
createdAt: string
updatedAt: string
```
