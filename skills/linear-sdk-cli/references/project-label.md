# linear project-label

> Manage project labels (distinct from issue labels)

Group alias: `pl`

_Generated from `linear commands --json`. `linear project-label --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear project-label`

Manage project labels (distinct from issue labels)

Aliases: `pl`

```
linear project-label [options]
```

### `linear project-label create`

Create a project label or label group

Aliases: `new`

```
linear project-label create [options]
```

| Option                     | Description                               |
| -------------------------- | ----------------------------------------- |
| `--name <name>`            | project label name                        |
| `--color <hex>`            | label color (six-digit hex, e.g. #5E6AD2) |
| `-d, --description <text>` | label description                         |
| `--group`                  | create a non-assignable label group       |
| `--parent <name-or-id>`    | put the label in this group               |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
color: string
```

### `linear project-label delete`

Permanently delete a project label

Aliases: `rm`

```
linear project-label delete [options] <name-or-id>
```

**Output (`--json`)**: a receipt object

```text
id: string
name: string
deleted: boolean
```

### `linear project-label list`

List project labels

Aliases: `ls`

```
linear project-label list [options]
```

| Option              | Description                                        |
| ------------------- | -------------------------------------------------- |
| `--include-retired` | include labels retired from new project assignment |

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
color: string
description: string | null
isGroup: boolean
parent: {id: string, name: string} | null
retiredAt: string | null
```

### `linear project-label restore`

Restore a retired project label

Aliases: `unretire`

```
linear project-label restore [options] <name-or-id>
```

**Output (`--json`)**: a receipt object

```text
id: string
name: string
restored: boolean
```

### `linear project-label retire`

Retire a label so it cannot be assigned to new projects

```
linear project-label retire [options] <name-or-id>
```

**Output (`--json`)**: a receipt object

```text
id: string
name: string
retired: boolean
```

### `linear project-label update`

Update a project label by exact name or id

Aliases: `edit`

```
linear project-label update [options] <name-or-id>
```

| Option                     | Description                             |
| -------------------------- | --------------------------------------- |
| `--name <name>`            | new name                                |
| `--color <hex>`            | new color (six-digit hex, e.g. #5E6AD2) |
| `-d, --description <text>` | new description                         |
| `--parent <name-or-id>`    | move the label into this group          |
| `--clear-parent`           | remove the label from its group         |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
color: string
```

### `linear project-label view`

View a project label or label group by exact name or id

```
linear project-label view [options] <name-or-id>
```

**Output (`--json`)**: a bare object

```text
id: string
name: string
color: string
description: string | null
isGroup: boolean
parent: {id: string, name: string} | null
retiredAt: string | null
children: Array<{id: string, name: string, color: string, retiredAt: string | null}>
```
