# linear auth

> Manage authentication

_Generated from `linear commands --json`. `linear auth --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

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
credentialType: string
storage: string
```

### `linear auth login`

Authenticate and select the workspace for this project

```
linear auth login [options]
```

| Option                 | Description                                                           |
| ---------------------- | --------------------------------------------------------------------- |
| `--no-project`         | save credentials without changing the project workspace               |
| `--key <key>`          | use a personal API key ('-' reads it from stdin)                      |
| `--plaintext`          | Store the key in the config file (0600) instead of the system keyring |
| `--no-browser`         | print the authorization URL instead of opening it                     |
| `--read-only`          | request read-only OAuth access                                        |
| `--admin`              | explicitly add the OAuth admin scope                                  |
| `--timeout <seconds>`  | seconds to wait for the loopback callback                             |
| `--client-id <id>`     | OAuth client ID (defaults to the packaged CLI app)                    |
| `--redirect-uri <uri>` | registered HTTP loopback callback URI                                 |

**Output (`--json`)**: a receipt object

```text
success: boolean
credentialType: string
workspace: string
user: {id: string, name: string, email: string}
storage: string
scopes?: string[]
expiresAt?: string
path: string
```

### `linear auth logout`

Remove a stored workspace credential (select with --workspace <slug>)

```
linear auth logout [options]
```

| Option         | Description                                       |
| -------------- | ------------------------------------------------- |
| `--local-only` | remove local credentials without OAuth revocation |

**Output (`--json`)**: a receipt object

```text
success: boolean
workspace: string
removed: boolean
revocation: string
fallbackCredentialType: string | null
teamMetadataRemoved: boolean
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

Show where the active credential is resolved from (value redacted)

```
linear auth status [options]
```

**Output (`--json`)**: a bare object

```text
authenticated: boolean
credentialType: string | null
source: string
workspace: string | null
key: string
keyring: string | null
scopes: string[] | null
expiresAt: string | null
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
