# linear initiative

> Work with initiatives

Group alias: `init`

_Generated from `linear commands --json`. `linear initiative --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

### `linear initiative`

Work with initiatives

Aliases: `init`

```
linear initiative [options]
```

### `linear initiative archive`

Archive an initiative

```
linear initiative archive [options] <id>
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

### `linear initiative delete`

Delete (trash) an initiative

Aliases: `rm`

```
linear initiative delete [options] <id>
```

### `linear initiative list`

List workspace initiatives

Aliases: `ls`

```
linear initiative list [options]
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

### `linear initiative view`

Show an initiative (by name or id)

Aliases: `show`

```
linear initiative view [options] <id>
```
