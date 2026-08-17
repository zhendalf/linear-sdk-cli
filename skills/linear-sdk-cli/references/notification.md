# linear notification

> Work with your notifications

Group alias: `notif`

_Generated from `linear commands --json`. `linear notification --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear notification`

Work with your notifications

Aliases: `notif`

```
linear notification [options]
```

### `linear notification archive`

Archive a notification

```
linear notification archive [options] <id>
```

**Output (`--json`)**: a receipt object

```text
id: string
archived: boolean
```

### `linear notification list`

List your notifications

Aliases: `ls`

```
linear notification list [options]
```

| Option               | Description                    |
| -------------------- | ------------------------------ |
| `--include-archived` | include archived notifications |

**Output (`--json`)**: a bare array of objects

```text
id: string
type: string
subject: string | null
read: boolean
readAt: string | null
snoozedUntilAt: string | null
archivedAt: string | null
createdAt: string
```

### `linear notification read`

Mark a notification as read

```
linear notification read [options] <id>
```

**Output (`--json`)**: a receipt object

```text
id: string
read: boolean
```

### `linear notification read-all`

Mark all your notifications as read

```
linear notification read-all [options]
```

**Output (`--json`)**: a receipt object

```text
success: boolean
count: number
attempted: number
failed: Array<{id: string, read: boolean, error?: string}>
```

### `linear notification snooze`

Snooze a notification until an ISO timestamp (e.g. 2026-07-01T09:00:00Z)

```
linear notification snooze [options] <id> <untilISO>
```

**Output (`--json`)**: a receipt object

```text
id: string
snoozedUntilAt: string
```

### `linear notification unread`

Mark a notification as unread

```
linear notification unread [options] <id>
```

**Output (`--json`)**: a receipt object

```text
id: string
read: boolean
```
