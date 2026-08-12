# linear notification

> Work with your notifications

Group alias: `notif`

_Generated from `linear commands --json`. `linear notification --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

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

### `linear notification list`

List your notifications

Aliases: `ls`

```
linear notification list [options]
```

| Option               | Description                    |
| -------------------- | ------------------------------ |
| `--include-archived` | include archived notifications |

### `linear notification read`

Mark a notification as read

```
linear notification read [options] <id>
```

### `linear notification read-all`

Mark all your notifications as read

```
linear notification read-all [options]
```

### `linear notification snooze`

Snooze a notification until an ISO timestamp (e.g. 2026-07-01T09:00:00Z)

```
linear notification snooze [options] <id> <untilISO>
```

### `linear notification unread`

Mark a notification as unread

```
linear notification unread [options] <id>
```
