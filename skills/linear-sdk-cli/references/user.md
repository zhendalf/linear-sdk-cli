# linear user

> Inspect workspace users

Group alias: `u`

_Generated from `linear commands --json`. `linear user --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

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

### `linear user me`

Show the authenticated viewer

```
linear user me [options]
```

### `linear user view`

Show a user (me, email, name, or id)

```
linear user view [options] <who>
```
