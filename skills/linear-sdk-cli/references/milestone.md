# linear milestone

> Work with project milestones

Group alias: `m`

_Generated from `linear commands --json`. `linear milestone --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear milestone`

Work with project milestones

Aliases: `m`

```
linear milestone [options]
```

### `linear milestone create`

Create a milestone in a project

Aliases: `new`

```
linear milestone create [options] <project>
```

| Option                      | Description                                |
| --------------------------- | ------------------------------------------ |
| `--name <name>`             | milestone name                             |
| `-d, --description <text>`  | milestone description (body)               |
| `--description-file <path>` | read description from a file ('-' = stdin) |
| `--target <date>`           | target date (YYYY-MM-DD)                   |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
```

### `linear milestone delete`

Delete a milestone (by id, or by name with --project)

Aliases: `rm`

```
linear milestone delete [options] <id>
```

| Option                 | Description                                                                      |
| ---------------------- | -------------------------------------------------------------------------------- |
| `-p, --project <name>` | the milestone's project, when <id> is a name (names are unique per project only) |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
deleted: boolean
```

### `linear milestone list`

List milestones in a project

Aliases: `ls`

```
linear milestone list [options] <project>
```

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
targetDate: string | null
progress: number
status: string
description: string | null
```

### `linear milestone update`

Update a milestone (by id, or by name with --project)

Aliases: `edit`

```
linear milestone update [options] <id>
```

| Option                      | Description                                                                      |
| --------------------------- | -------------------------------------------------------------------------------- |
| `-p, --project <name>`      | the milestone's project, when <id> is a name (names are unique per project only) |
| `--name <name>`             | new name                                                                         |
| `-d, --description <text>`  | new description                                                                  |
| `--description-file <path>` | read description from a file ('-' = stdin)                                       |
| `--target <date>`           | target date (YYYY-MM-DD)                                                         |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
```

### `linear milestone view`

Show a milestone and the issues in it (by id, or by name with --project)

```
linear milestone view [options] <id>
```

| Option                 | Description                                                                      |
| ---------------------- | -------------------------------------------------------------------------------- |
| `-p, --project <name>` | the milestone's project, when <id> is a name (names are unique per project only) |

**Output (`--json`)**: a bare object

```text
id: string
name: string
description: string | null
targetDate: string | null
progress: number
status: string
project: {id: string, name: string} | null
createdAt: string
updatedAt: string
issues: Array<{id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null}>
issuesTruncated: boolean
```
