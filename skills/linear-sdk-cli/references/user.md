# linear user

> Inspect workspace users

Group alias: `u`

_Generated from `linear commands --json`. `linear user --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear user`

Inspect workspace users

Aliases: `u`

```
linear user [options]
```

### `linear user list`

List workspace users

Aliases: `ls`

```
linear user list [options]
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
admin: boolean
guest: boolean
```

### `linear user me`

Show the authenticated viewer

```
linear user me [options]
```

**Output (`--json`)**: a bare object

```text
id: string
displayName: string
name: string
email: string
active: boolean
admin: boolean
guest: boolean
isMe: boolean
description: string | null
statusLabel: string | null
timezone: string | null
url: string
avatarUrl: string | null
lastSeen: string | null
createdAt: string
updatedAt: string
```

### `linear user view`

Show a user (me, email, name, or id)

```
linear user view [options] <who>
```

**Output (`--json`)**: a bare object

```text
id: string
displayName: string
name: string
email: string
active: boolean
admin: boolean
guest: boolean
isMe: boolean
description: string | null
statusLabel: string | null
timezone: string | null
url: string
avatarUrl: string | null
lastSeen: string | null
createdAt: string
updatedAt: string
```
