# linear auth

> Manage authentication

_Generated from `linear commands --json`. `linear auth --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear auth`

Manage authentication

```
linear auth [options]
```

### `linear auth adopt`

Adopt an existing named credential from the shared OS keyring

```
linear auth adopt [options] <slug>
```

**Output (`--json`)**: a receipt object

```text
success: boolean
workspace: string
user: {id: string, name: string, email: string}
storage: string
path: string
```

### `linear auth default`

Set the default workspace credential

```
linear auth default [options] <slug>
```

**Output (`--json`)**: a receipt object

```text
success: boolean
default_workspace: string
path: string
```

### `linear auth list`

List configured workspace credentials

Aliases: `ls`

```
linear auth list [options]
```

**Output (`--json`)**: a bare array of objects

```text
slug: string
isDefault: boolean
storage: string
```

### `linear auth login`

Validate and store a Linear API key for a workspace

```
linear auth login [options]
```

| Option        | Description                                                           |
| ------------- | --------------------------------------------------------------------- |
| `--key <key>` | API key (otherwise prompted; '-' reads it from stdin)                 |
| `--plaintext` | Store the key in the config file (0600) instead of the system keyring |

**Output (`--json`)**: a receipt object

```text
success: boolean
workspace: string
user: {id: string, name: string, email: string}
storage: string
path: string
```

### `linear auth logout`

Remove a stored workspace credential (select with --workspace <slug>)

```
linear auth logout [options]
```

**Output (`--json`)**: a receipt object

```text
success: boolean
workspace: string
removed: boolean
```

### `linear auth migrate`

Move plaintext credentials from the config file into the system keyring

```
linear auth migrate [options]
```

**Output (`--json`)**: a receipt object

```text
success: boolean
migrated: string[]
path: string
```

### `linear auth status`

Show where the API key is resolved from (key redacted)

```
linear auth status [options]
```

**Output (`--json`)**: a bare object

```text
authenticated: boolean
source: string
workspace: string | null
key: string
keyring: string | null
```

### `linear auth token`

Print the resolved API key for the active workspace (for scripting)

```
linear auth token [options]
```

**Output (`--json`)**: a bare object

```text
apiKey: string
workspace: string | null
```

### `linear auth whoami`

Show the authenticated user

```
linear auth whoami [options]
```

**Output (`--json`)**: a bare object

```text
id: string
name: string
displayName: string
email: string
admin: boolean
organization: {id: string, name: string, urlKey: string}
```
