# linear custom-view

> Create and manage saved custom views

Group alias: `cv`

_Generated from `linear commands --json`. `linear custom-view --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear custom-view`

Create and manage saved custom views

Aliases: `cv`

```
linear custom-view [options]
```

**Output (`--json`)**: a bare object — runs `custom-view view` by default

```text
id: string
name: string
type: string
shared: boolean
owner: {id: string, displayName: string} | null
team: {id: string, key: string, name: string} | null
slugId: string
updatedAt: string
description: string | null
filter: object
color: string | null
icon: string | null
creator: {id: string, displayName: string} | null
createdAt: string
archivedAt: string | null
```

### `linear custom-view create`

Create an issue, project, or initiative custom view

Aliases: `new`

```
linear custom-view create [options]
```

| Option                          | Description                                    |
| ------------------------------- | ---------------------------------------------- |
| `--name <name>`                 | view name                                      |
| `--type <type>`                 | entity type                                    |
| `--owner <who>`                 | owner (me\|email\|name\|id)                    |
| `--color <hex>`                 | icon color                                     |
| `--icon <icon>`                 | emoji or decorative icon identifier            |
| `--scope-team <key\|name\|id>`  | attach the view to a team                      |
| `--scope-project <id\|name>`    | attach the view to a project                   |
| `--scope-initiative <id\|name>` | attach the view to an initiative               |
| `-d, --description <text>`      | view description                               |
| `--description-file <path>`     | read description from a file ('-' = stdin)     |
| `--filter <json>`               | typed Linear filter as a JSON object           |
| `--filter-file <path>`          | read the filter JSON from a file ('-' = stdin) |
| `--shared`                      | share the view with the workspace              |
| `--personal`                    | make the view owner-only                       |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
type: string
shared: boolean
slugId: string
```

### `linear custom-view delete`

Delete a custom view by UUID

Aliases: `rm`

```
linear custom-view delete [options] <id>
```

**Output (`--json`)**: a receipt object

```text
id: string
name: string
deleted: boolean
```

### `linear custom-view list`

List accessible workspace and team custom views

Aliases: `ls`

```
linear custom-view list [options]
```

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
type: string
shared: boolean
owner: {id: string, displayName: string} | null
team: {id: string, key: string, name: string} | null
slugId: string
updatedAt: string
```

### `linear custom-view results`

List issues, projects, or initiatives matched by a view UUID

Aliases: `items`

```
linear custom-view results [options] <id>
```

**Output (`--json`)**: a bare array of objects

```text
type: string
id: string
identifier: string | null
name: string
url: string
```

### `linear custom-view update`

Update mutable fields on a custom view UUID

Aliases: `edit`

```
linear custom-view update [options] <id>
```

| Option                         | Description                                    |
| ------------------------------ | ---------------------------------------------- |
| `--name <name>`                | new name                                       |
| `--owner <who>`                | new owner (me\|email\|name\|id)                |
| `--color <hex>`                | new icon color                                 |
| `--clear-color`                | clear the icon color                           |
| `--icon <icon>`                | new icon                                       |
| `--clear-icon`                 | clear the icon                                 |
| `--clear-description`          | clear the description                          |
| `--scope-team <key\|name\|id>` | set the public team scope                      |
| `--clear-team-scope`           | clear the public team scope                    |
| `-d, --description <text>`     | new description                                |
| `--description-file <path>`    | read description from a file ('-' = stdin)     |
| `--filter <json>`              | typed Linear filter as a JSON object           |
| `--filter-file <path>`         | read the filter JSON from a file ('-' = stdin) |
| `--shared`                     | share the view with the workspace              |
| `--personal`                   | make the view owner-only                       |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
type: string
shared: boolean
slugId: string
```

### `linear custom-view view`

Show a custom view by UUID

Aliases: `show`

```
linear custom-view view [options] <id>
```

**Output (`--json`)**: a bare object

```text
id: string
name: string
type: string
shared: boolean
owner: {id: string, displayName: string} | null
team: {id: string, key: string, name: string} | null
slugId: string
updatedAt: string
description: string | null
filter: object
color: string | null
icon: string | null
creator: {id: string, displayName: string} | null
createdAt: string
archivedAt: string | null
```
