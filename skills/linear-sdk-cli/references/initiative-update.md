# linear initiative-update

> Post and list initiative status updates

Group alias: `iu`

_Generated from `linear commands --json`. `linear initiative-update --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

### `linear initiative-update`

Post and list initiative status updates

Aliases: `iu`

```
linear initiative-update [options]
```

### `linear initiative-update create`

Post a status update on an initiative (by name or id)

Aliases: `new`

```
linear initiative-update create [options] <initiative>
```

| Option               | Description                         |
| -------------------- | ----------------------------------- |
| `--body <text>`      | update body (markdown)              |
| `--body-file <path>` | read body from a file ('-' = stdin) |
| `--editor`           | compose the body in $EDITOR         |
| `--health <state>`   | status health                       |

### `linear initiative-update list`

List an initiative's status updates

Aliases: `ls`

```
linear initiative-update list [options] <initiative>
```
