# linear release-pipeline

> Manage release pipelines (Business/Enterprise)

_Generated from `linear commands --json`. `linear release-pipeline --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear release-pipeline`

Manage release pipelines (Business/Enterprise)

```
linear release-pipeline [options]
```

### `linear release-pipeline create`

Create a pipeline with default stages

```
linear release-pipeline create [options]
```

| Option                           | Description                                                                |
| -------------------------------- | -------------------------------------------------------------------------- |
| `--name <name>`                  | pipeline name                                                              |
| `--type <type>`                  | pipeline type                                                              |
| `--production <boolean>`         | whether pipeline targets production (true\|false)                          |
| `--auto-release-notes <boolean>` | automatically generate notes on completion (true\|false)                   |
| `--rollover-issues <boolean>`    | move open issues to the next scheduled release on completion (true\|false) |
| `--include-path <glob>`          | replace path patterns with these globs (repeatable)                        |
| `--clear-paths`                  | clear all path filters                                                     |
| `--team-id <uuid>`               | replace associated teams with these UUIDs (repeatable)                     |
| `--clear-teams`                  | clear team associations                                                    |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
slugId: string
type: string
url: string
isProduction: boolean
autoGenerateReleaseNotesOnCompletion: boolean
rolloverIssuesOnCompletion: boolean
includePathPatterns: string[]
archivedAt: string | null
```

### `linear release-pipeline list`

List workspace release pipelines

Aliases: `ls`

```
linear release-pipeline list [options]
```

| Option               | Description                |
| -------------------- | -------------------------- |
| `--include-archived` | include archived pipelines |

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
slugId: string
type: string
url: string
isProduction: boolean
autoGenerateReleaseNotesOnCompletion: boolean
rolloverIssuesOnCompletion: boolean
includePathPatterns: string[]
archivedAt: string | null
```

### `linear release-pipeline update`

Update pipeline settings by UUID or slug

```
linear release-pipeline update [options] <id>
```

| Option                           | Description                                                                |
| -------------------------------- | -------------------------------------------------------------------------- |
| `--name <name>`                  | pipeline name                                                              |
| `--type <type>`                  | pipeline type                                                              |
| `--production <boolean>`         | whether pipeline targets production (true\|false)                          |
| `--auto-release-notes <boolean>` | automatically generate notes on completion (true\|false)                   |
| `--rollover-issues <boolean>`    | move open issues to the next scheduled release on completion (true\|false) |
| `--include-path <glob>`          | replace path patterns with these globs (repeatable)                        |
| `--clear-paths`                  | clear all path filters                                                     |
| `--team-id <uuid>`               | replace associated teams with these UUIDs (repeatable)                     |
| `--clear-teams`                  | clear team associations                                                    |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
slugId: string
type: string
url: string
isProduction: boolean
autoGenerateReleaseNotesOnCompletion: boolean
rolloverIssuesOnCompletion: boolean
includePathPatterns: string[]
archivedAt: string | null
```

### `linear release-pipeline view`

Show pipeline settings by UUID or slug

```
linear release-pipeline view [options] <id>
```

**Output (`--json`)**: a bare object

```text
id: string
name: string
slugId: string
type: string
url: string
isProduction: boolean
autoGenerateReleaseNotesOnCompletion: boolean
rolloverIssuesOnCompletion: boolean
includePathPatterns: string[]
archivedAt: string | null
```
