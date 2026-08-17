# linear project-update

> Post and list project status updates

Group alias: `pu`

_Generated from `linear commands --json`. `linear project-update --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear project-update`

Post and list project status updates

Aliases: `pu`

```
linear project-update [options]
```

### `linear project-update create`

Post a status update on a project (by name or id)

Aliases: `new`

```
linear project-update create [options] <project>
```

| Option               | Description                         |
| -------------------- | ----------------------------------- |
| `--body <text>`      | update body (markdown)              |
| `--body-file <path>` | read body from a file ('-' = stdin) |
| `--editor`           | compose the body in $EDITOR         |
| `--health <state>`   | status health                       |

**Output (`--json`)**: a receipt object

```text
id: string
createdAt: string
user: string
body: string
health: string | null
url: string
```

### `linear project-update list`

List a project's status updates

Aliases: `ls`

```
linear project-update list [options] <project>
```

**Output (`--json`)**: a bare array of objects

```text
id: string
createdAt: string
user: string
body: string
health: string | null
```
