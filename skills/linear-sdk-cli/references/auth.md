# linear auth

> Manage authentication

_Generated from `linear commands --json`. `linear auth --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

### `linear auth`

Manage authentication

```
linear auth [options]
```

### `linear auth default`

Set the default workspace credential

```
linear auth default [options] <slug>
```

### `linear auth list`

List configured workspace credentials

Aliases: `ls`

```
linear auth list [options]
```

### `linear auth login`

Validate and store a Linear API key for a workspace

```
linear auth login [options]
```

| Option        | Description                  |
| ------------- | ---------------------------- |
| `--key <key>` | API key (otherwise prompted) |

### `linear auth logout`

Remove a stored workspace credential (select with --workspace <slug>)

```
linear auth logout [options]
```

### `linear auth status`

Show where the API key is resolved from (key redacted)

```
linear auth status [options]
```

### `linear auth token`

Print the resolved API key for the active workspace (for scripting)

```
linear auth token [options]
```

### `linear auth whoami`

Show the authenticated user

```
linear auth whoami [options]
```
