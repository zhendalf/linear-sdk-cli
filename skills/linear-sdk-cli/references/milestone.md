# linear milestone

> Work with project milestones

Group alias: `m`

_Generated from `linear commands --json`. `linear milestone --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

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

### `linear milestone delete`

Delete a milestone

Aliases: `rm`

```
linear milestone delete [options] <id>
```

### `linear milestone list`

List milestones in a project

Aliases: `ls`

```
linear milestone list [options] <project>
```

### `linear milestone update`

Update a milestone

Aliases: `edit`

```
linear milestone update [options] <id>
```

| Option                      | Description                                |
| --------------------------- | ------------------------------------------ |
| `--name <name>`             | new name                                   |
| `-d, --description <text>`  | new description                            |
| `--description-file <path>` | read description from a file ('-' = stdin) |
| `--target <date>`           | target date (YYYY-MM-DD)                   |

### `linear milestone view`

Show a milestone and the issues in it

```
linear milestone view [options] <id>
```
