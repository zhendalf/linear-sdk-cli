# linear document

> Work with documents

Group alias: `doc`

_Generated from `linear commands --json`. `linear document --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

### `linear document`

Work with documents

Aliases: `doc`

```
linear document [options]
```

### `linear document create`

Create a new document (requires a container: --project, --issue, or --team)

Aliases: `new`

```
linear document create [options]
```

| Option                  | Description                            |
| ----------------------- | -------------------------------------- |
| `--title <title>`       | document title                         |
| `--content <text>`      | document content (markdown body)       |
| `--content-file <path>` | read content from a file ('-' = stdin) |
| `-p, --project <name>`  | container: a project (name or id)      |
| `--issue <id>`          | container: an issue (identifier or id) |

### `linear document delete`

Delete (trash) a document

Aliases: `rm`

```
linear document delete [options] <id>
```

### `linear document list`

List workspace documents

Aliases: `ls`

```
linear document list [options]
```

### `linear document update`

Update a document

Aliases: `edit`

```
linear document update [options] <id>
```

| Option                  | Description                            |
| ----------------------- | -------------------------------------- |
| `--title <title>`       | new title                              |
| `--content <text>`      | new content (markdown body)            |
| `--content-file <path>` | read content from a file ('-' = stdin) |

### `linear document view`

Show a document, including its markdown content

Aliases: `show`

```
linear document view [options] <id>
```
