# linear config

> Show the resolved configuration, or write a project config

_Generated from `linear commands --json`. `linear config --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear config`

Show the resolved configuration, or write a project config

```
linear config [options]
```

**Output (`--json`)**: a bare object — runs `config show` by default

```text
apiKey: string
apiKeySource: string
credentialWorkspace: string | null
team: string | null
workspace: string | null
sort: string
vcs: string
origins: {team: {source: string, path?: string}, workspace: {source: string, path?: string}, sort: {source: string, path?: string}, vcs: {source: string, path?: string}}
userConfigPath: string
projectConfigPath: string | null
globalConfigPath: string | null
```

### `linear config init`

Write a project .linear.toml (at the git root, or here outside a repository)

```
linear config init [options]
```

| Option           | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `--team <key>`   | default team key (otherwise chosen from a list)          |
| `--sort <order>` | default issue-list sort (priority \| updated \| created) |
| `--path <file>`  | write this file instead of <git root>/.linear.toml       |
| `--force`        | overwrite an existing file                               |

**Output (`--json`)**: a receipt object

```text
success: boolean
path: string
team: string
sort?: string
```

### `linear config set`

Set one project setting (team, workspace, sort, vcs) in the project config

```
linear config set [options] <key> <value>
```

| Option          | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `--user`        | write the user config (~/.config/linear/config.toml) instead |
| `--path <file>` | write this file instead of the project config in effect      |

**Output (`--json`)**: a receipt object

```text
success: boolean
path: string
key: string
value: string
```

### `linear config show`

Show the resolved configuration and where each value came from (secrets redacted)

```
linear config show [options]
```

**Output (`--json`)**: a bare object

```text
apiKey: string
apiKeySource: string
credentialWorkspace: string | null
team: string | null
workspace: string | null
sort: string
vcs: string
origins: {team: {source: string, path?: string}, workspace: {source: string, path?: string}, sort: {source: string, path?: string}, vcs: {source: string, path?: string}}
userConfigPath: string
projectConfigPath: string | null
globalConfigPath: string | null
```
