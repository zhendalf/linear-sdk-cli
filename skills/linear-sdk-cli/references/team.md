# linear team

> Inspect and manage teams

Group alias: `t`

_Generated from `linear commands --json`. `linear team --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

### `linear team`

Inspect and manage teams

Aliases: `t`

```
linear team [options]
```

### `linear team create`

Create a new team

Aliases: `new`

```
linear team create [options]
```

| Option                     | Description                                             |
| -------------------------- | ------------------------------------------------------- |
| `--name <name>`            | team name                                               |
| `--key <key>`              | team key (e.g. ENG); generated from the name if omitted |
| `-d, --description <text>` | team description                                        |

### `linear team cycles`

List a team's cycles

```
linear team cycles [options] [key]
```

### `linear team labels`

List a team's labels

```
linear team labels [options] [key]
```

### `linear team list`

List all teams

Aliases: `ls`

```
linear team list [options]
```

### `linear team members`

List a team's members

```
linear team members [options] [key]
```

| Option               | Description                                     |
| -------------------- | ----------------------------------------------- |
| `--include-disabled` | include deactivated users (excluded by default) |

### `linear team states`

List a team's workflow states

```
linear team states [options] [key]
```

### `linear team update`

Update a team (defaults to the configured team)

Aliases: `edit`

```
linear team update [options] [key]
```

| Option                     | Description          |
| -------------------------- | -------------------- |
| `--name <name>`            | new team name        |
| `--key <key>`              | new team key         |
| `-d, --description <text>` | new team description |

### `linear team view`

Show a team (defaults to the configured team)

```
linear team view [options] [key]
```
