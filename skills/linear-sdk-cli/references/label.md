# linear label

> Work with issue labels

Group alias: `lb`

_Generated from `linear commands --json`. `linear label --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

### `linear label`

Work with issue labels

Aliases: `lb`

```
linear label [options]
```

### `linear label create`

Create a label (scoped to --team if set, else workspace-level)

Aliases: `new`

```
linear label create [options]
```

| Option                     | Description                                                             |
| -------------------------- | ----------------------------------------------------------------------- |
| `--name <name>`            | label name                                                              |
| `--color <hex>`            | label color (e.g. #EB5757)                                              |
| `-d, --description <text>` | label description                                                       |
| `--shared`                 | create a workspace-level (shared) label even when a default team is set |
| `--parent <name>`          | parent label (creates a sub-label)                                      |

### `linear label delete`

Delete a label (by name or id)

Aliases: `rm`

```
linear label delete [options] <id>
```

### `linear label list`

List labels (optionally scoped to a team)

Aliases: `ls`

```
linear label list [options] [team]
```

### `linear label update`

Update a label (by name or id)

Aliases: `edit`

```
linear label update [options] <id>
```

| Option                     | Description                    |
| -------------------------- | ------------------------------ |
| `--name <name>`            | new label name                 |
| `--color <hex>`            | new label color (e.g. #EB5757) |
| `-d, --description <text>` | new label description          |
