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

Sign in with a personal API key (default) or app credentials

```
linear auth login [options]
```

| Option                     | Description                                                             |
| -------------------------- | ----------------------------------------------------------------------- |
| `--no-project`             | save credentials without changing the project workspace                 |
| `--key <key>`              | use a personal API key ('-' reads it from stdin)                        |
| `--plaintext`              | Store API-key or app credentials in the private user config file (0600) |
| `--read-only`              | request read-only access with --app                                     |
| `--app`                    | sign in as an app using client credentials                              |
| `--client-credentials`     | alias for --app                                                         |
| `--scope <scopes>`         | comma-separated app scopes (default: read,write)                        |
| `--client-secret <secret>` | app client secret ('-' reads stdin; defaults to LINEAR_CLIENT_SECRET)   |
| `--client-id <id>`         | app client ID (defaults to LINEAR_CLIENT_ID)                            |

**Output (`--json`)**: a receipt object

```text
success: boolean
credentialType: string
workspace: string
user: {id: string, name: string, email: string}
storage: string
path: string
projectConfigPath: string | null
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

### `linear auth rename`

Rename a stored API-key profile after its Linear workspace URL slug changes

```
linear auth rename [options] <old-slug> <new-slug>
```

| Option                        | Description                                                                |
| ----------------------------- | -------------------------------------------------------------------------- |
| `--project-config <paths...>` | also inspect these project configs for old workspace selectors (read-only) |

**Output (`--json`)**: a receipt object

```text
success: boolean
from: string
workspace: string
credentialType: string
organization: {id: string, name: string, urlKey: string}
path: string
storage: string
team: string | null
defaultWorkspace: string | null
referenceCredentialsPath: string | null
checkedProjectConfigs: string[]
projectConfigUpdates: Array<{path: string, key: string, from: string, to: string}>
globalConfigUpdates: Array<{path: string, key: string, from: string, to: string}>
otherProjects: string
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
scopeVisibility: string
adminScope: boolean | null
scopeNote: string
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
authorization: {credentialType: string | null, scopeVisibility: string, scopes: string[] | null, adminScope: boolean | null, note: string}
organization: {id: string, name: string, urlKey: string}
```
