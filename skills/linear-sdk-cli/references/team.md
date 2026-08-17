# linear team

> Inspect and manage teams

Group alias: `t`

_Generated from `linear commands --json`. `linear team --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

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
| `--private`                | make the team private (members only)                    |

**Output (`--json`)**: a receipt object

```text
id: string
key: string
name: string
```

### `linear team cycles`

List a team's cycles

```
linear team cycles [options] [key]
```

**Output (`--json`)**: a bare array of objects

```text
id: string
number: number
name: string | null
startsAt: string | null
endsAt: string | null
```

### `linear team delete`

Delete a team (admin); its issues go with it unless --move-issues

Aliases: `rm`

```
linear team delete [options] <key>
```

| Option                 | Description                                  |
| ---------------------- | -------------------------------------------- |
| `--move-issues <team>` | move the team's issues to another team first |

**Output (`--json`)**: a receipt object

```text
id: string
key: string
name: string
deleted: boolean
movedIssues: number
movedTo: {id: string, key: string, name: string} | null
```

### `linear team labels`

List a team's labels

```
linear team labels [options] [key]
```

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
color: string
```

### `linear team list`

List all teams

Aliases: `ls`

```
linear team list [options]
```

**Output (`--json`)**: a bare array of objects

```text
id: string
key: string
name: string
```

### `linear team members`

List a team's members

```
linear team members [options] [key]
```

| Option               | Description                                     |
| -------------------- | ----------------------------------------------- |
| `--include-disabled` | include deactivated users (excluded by default) |

**Output (`--json`)**: a bare array of objects

```text
id: string
displayName: string
name: string
email: string
active: boolean
```

### `linear team states`

List a team's workflow states

```
linear team states [options] [key]
```

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
type: string
color: string
position: number
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

**Output (`--json`)**: a receipt object

```text
id: string
key: string
name: string
```

### `linear team view`

Show a team (defaults to the configured team)

```
linear team view [options] [key]
```

**Output (`--json`)**: a bare object

```text
id: string
key: string
name: string
description: string | null
private: boolean
cyclesEnabled: boolean
timezone: string | null
color: string | null
icon: string | null
issueCount: number
memberCount: number
createdAt: string
updatedAt: string
```
