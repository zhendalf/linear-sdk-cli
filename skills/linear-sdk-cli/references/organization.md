# linear organization

> Inspect the current workspace

Group alias: `org`

_Generated from `linear commands --json`. `linear organization --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear organization`

Inspect the current workspace

Aliases: `org`

```
linear organization [options]
```

**Output (`--json`)**: a bare object — runs `organization view` by default

```text
id: string
name: string
urlKey: string
userCount: number
createdIssueCount: number
samlEnabled: boolean
scimEnabled: boolean
roadmapEnabled: boolean
logoUrl: string | null
createdAt: string
updatedAt: string
```

### `linear organization invites`

List organization invites

```
linear organization invites [options]
```

**Output (`--json`)**: a bare array of objects

```text
id: string
email: string
status: string
role: string
external: boolean
createdAt: string
```

### `linear organization members`

List workspace members

```
linear organization members [options]
```

**Output (`--json`)**: a bare array of objects

```text
id: string
displayName: string
name: string
email: string
admin: boolean
active: boolean
```

### `linear organization view`

Show the current workspace

Aliases: `show`

```
linear organization view [options]
```

**Output (`--json`)**: a bare object

```text
id: string
name: string
urlKey: string
userCount: number
createdIssueCount: number
samlEnabled: boolean
scimEnabled: boolean
roadmapEnabled: boolean
logoUrl: string | null
createdAt: string
updatedAt: string
```
