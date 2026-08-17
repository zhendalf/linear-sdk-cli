# linear document

> Work with documents

Group alias: `doc`

_Generated from `linear commands --json`. `linear document --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear document`

Work with documents

Aliases: `doc`

```
linear document [options]
```

### `linear document create`

Create a new document, attached to one target (--project, --issue, --initiative, --team, --cycle, or --release; default: the configured team)

Aliases: `new`

```
linear document create [options]
```

| Option                  | Description                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| `--title <title>`       | document title                                                                 |
| `--content <text>`      | document content (markdown body)                                               |
| `--content-file <path>` | read content from a file ('-' = stdin)                                         |
| `-p, --project <name>`  | attach to a project (name or id)                                               |
| `--issue <id>`          | attach to an issue (identifier or id)                                          |
| `--initiative <name>`   | attach to an initiative (name or id)                                           |
| `--cycle <n>`           | attach to a cycle (number, name, id, or 'current'; team from --team or config) |
| `--release <name>`      | attach to a release (name, version, or id)                                     |

### `linear document delete`

Delete (trash) a document

Aliases: `rm`

```
linear document delete [options] <id>
```

### `linear document list`

List workspace documents (optionally only those attached to one target)

Aliases: `ls`

```
linear document list [options]
```

| Option                 | Description                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `-p, --project <name>` | only documents attached to a project (name or id)                                               |
| `--issue <id>`         | only documents attached to an issue (identifier or id)                                          |
| `--initiative <name>`  | only documents attached to an initiative (name or id)                                           |
| `--cycle <n>`          | only documents attached to a cycle (number, name, id, or 'current'; team from --team or config) |
| `--release <name>`     | only documents attached to a release (name, version, or id)                                     |

### `linear document update`

Update a document's title or content, or re-point it to another target

Aliases: `edit`

```
linear document update [options] <id>
```

| Option                  | Description                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| `--title <title>`       | new title                                                                        |
| `--content <text>`      | new content (markdown body)                                                      |
| `--content-file <path>` | read content from a file ('-' = stdin)                                           |
| `-p, --project <name>`  | re-point to a project (name or id)                                               |
| `--issue <id>`          | re-point to an issue (identifier or id)                                          |
| `--initiative <name>`   | re-point to an initiative (name or id)                                           |
| `--cycle <n>`           | re-point to a cycle (number, name, id, or 'current'; team from --team or config) |
| `--release <name>`      | re-point to a release (name, version, or id)                                     |

### `linear document view`

Show a document, including its markdown content

Aliases: `show`

```
linear document view [options] <id>
```
