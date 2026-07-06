# linear roadmap

> Work with roadmaps

Group alias: `rm`

_Generated from `linear commands --json`. `linear roadmap --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

### `linear roadmap`

Work with roadmaps

Aliases: `rm`

```
linear roadmap [options]
```

### `linear roadmap create`

Create a new roadmap

Aliases: `new`

```
linear roadmap create [options]
```

| Option                      | Description                                |
| --------------------------- | ------------------------------------------ |
| `--name <name>`             | roadmap name                               |
| `-d, --description <text>`  | roadmap description                        |
| `--description-file <path>` | read description from a file ('-' = stdin) |
| `--owner <who>`             | roadmap owner (me\|email\|name\|id)        |
| `--color <hex>`             | roadmap color (e.g. #5e6ad2)               |

### `linear roadmap delete`

Delete a roadmap

Aliases: `rm`

```
linear roadmap delete [options] <id>
```

### `linear roadmap list`

List roadmaps

Aliases: `ls`

```
linear roadmap list [options]
```

### `linear roadmap update`

Update a roadmap

Aliases: `edit`

```
linear roadmap update [options] <id>
```

| Option                      | Description                                |
| --------------------------- | ------------------------------------------ |
| `--name <name>`             | new name                                   |
| `-d, --description <text>`  | new description                            |
| `--description-file <path>` | read description from a file ('-' = stdin) |
| `--owner <who>`             | roadmap owner (me\|email\|name\|id)        |
| `--color <hex>`             | roadmap color (e.g. #5e6ad2)               |

### `linear roadmap view`

Show a roadmap (by name or id)

Aliases: `show`

```
linear roadmap view [options] <id>
```
