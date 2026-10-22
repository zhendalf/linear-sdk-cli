# linear release

> Track releases and issue membership (Business/Enterprise)

_Generated from `linear commands --json`. `linear release --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear release`

Track releases and issue membership (Business/Enterprise)

```
linear release [options]
```

### `linear release add-issue`

Add an issue (KEY-123 or UUID) to an exact release

```
linear release add-issue [options] <id> <issue>
```

**Output (`--json`)**: a receipt object

```text
id: string
releaseId: string
issueId: string
identifier: string
```

### `linear release complete`

Complete an explicit scheduled release; may roll open issues forward

```
linear release complete [options]
```

| Option                        | Description                                                          |
| ----------------------------- | -------------------------------------------------------------------- |
| `--description <text>`        | release description (Markdown)                                       |
| `--description-file <path>`   | read description from file ('-' for stdin)                           |
| `--clear-description`         | clear the description                                                |
| `--pipeline <id\|slug>`       | target pipeline UUID or slug                                         |
| `--release-version <version>` | explicit release version within the pipeline (no latest fallback)    |
| `--name <name>`               | release name                                                         |
| `--link <label=url\|url>`     | attach an external link (repeatable)                                 |
| `--commit-sha <sha>`          | full SHA (Linear preserves an existing SHA when targeting a version) |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
version: string | null
commitSha: string | null
url: string
pipeline: {id: string, name: string, type: string}
stage: {id: string, name: string, type: string, frozen: boolean}
startDate: string | null
targetDate: string | null
startedAt: string | null
completedAt: string | null
canceledAt: string | null
archivedAt: string | null
description: string | null
issueCount: number
```

### `linear release create`

Create a release (stage defaults depend on pipeline type)

Aliases: `new`

```
linear release create [options]
```

| Option                        | Description                                  |
| ----------------------------- | -------------------------------------------- |
| `--description <text>`        | release description (Markdown)               |
| `--description-file <path>`   | read description from file ('-' for stdin)   |
| `--clear-description`         | clear the description                        |
| `--name <name>`               | release name                                 |
| `--release-version <version>` | release version (unique within the pipeline) |
| `--commit-sha <sha>`          | full Git commit SHA                          |
| `--stage <id>`                | stage UUID from the same pipeline            |
| `--start-date <date>`         | estimated start date (YYYY-MM-DD)            |
| `--target-date <date>`        | estimated completion date (YYYY-MM-DD)       |
| `--pipeline <id\|slug>`       | pipeline UUID or slug                        |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
version: string | null
commitSha: string | null
url: string
pipeline: {id: string, name: string, type: string}
stage: {id: string, name: string, type: string, frozen: boolean}
startDate: string | null
targetDate: string | null
startedAt: string | null
completedAt: string | null
canceledAt: string | null
archivedAt: string | null
description: string | null
issueCount: number
```

### `linear release issues`

List issues in a release (UUID or slug)

```
linear release issues [options] <id>
```

**Output (`--json`)**: a bare array of objects

```text
id: string
identifier: string
title: string
url: string
```

### `linear release links`

List external links on a release (UUID or slug)

```
linear release links [options] <id>
```

**Output (`--json`)**: a bare array of objects

```text
id: string
label: string | null
url: string
```

### `linear release list`

List releases, optionally scoped to a pipeline

Aliases: `ls`

```
linear release list [options]
```

| Option                        | Description                     |
| ----------------------------- | ------------------------------- |
| `--pipeline <id\|slug>`       | filter by pipeline UUID or slug |
| `--release-version <version>` | filter by exact version         |
| `--stage-type <type>`         | filter by lifecycle stage type  |
| `--include-archived`          | include archived releases       |

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
version: string | null
commitSha: string | null
url: string
pipeline: {id: string, name: string, type: string}
stage: {id: string, name: string, type: string, frozen: boolean}
startDate: string | null
targetDate: string | null
startedAt: string | null
completedAt: string | null
canceledAt: string | null
archivedAt: string | null
```

### `linear release remove-issue`

Remove an issue from an exact release

```
linear release remove-issue [options] <id> <issue>
```

**Output (`--json`)**: a receipt object

```text
releaseId: string
issue: string
removed: boolean
```

### `linear release sync`

Sync explicit issue references; continuous pipelines complete immediately

```
linear release sync [options]
```

| Option                         | Description                                                       |
| ------------------------------ | ----------------------------------------------------------------- |
| `--description <text>`         | release description (Markdown)                                    |
| `--description-file <path>`    | read description from file ('-' for stdin)                        |
| `--clear-description`          | clear the description                                             |
| `--pipeline <id\|slug>`        | target pipeline UUID or slug                                      |
| `--release-version <version>`  | explicit release version within the pipeline (no latest fallback) |
| `--name <name>`                | release name                                                      |
| `--link <label=url\|url>`      | attach an external link (repeatable)                              |
| `--commit-sha <sha>`           | full Git commit SHA (no implicit checkout scanning)               |
| `--issue <key[=sha]>`          | issue reference, defaulting to --commit-sha (repeatable)          |
| `--reverted-issue <key[=sha]>` | reverted issue reference to remove (repeatable)                   |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
version: string | null
commitSha: string | null
url: string
pipeline: {id: string, name: string, type: string}
stage: {id: string, name: string, type: string, frozen: boolean}
startDate: string | null
targetDate: string | null
startedAt: string | null
completedAt: string | null
canceledAt: string | null
archivedAt: string | null
description: string | null
issueCount: number
```

### `linear release update`

Update exact release metadata or stage by UUID/slug

Aliases: `edit`

```
linear release update [options] <id>
```

| Option                        | Description                                  |
| ----------------------------- | -------------------------------------------- |
| `--description <text>`        | release description (Markdown)               |
| `--description-file <path>`   | read description from file ('-' for stdin)   |
| `--clear-description`         | clear the description                        |
| `--name <name>`               | release name                                 |
| `--release-version <version>` | release version (unique within the pipeline) |
| `--commit-sha <sha>`          | full Git commit SHA                          |
| `--stage <id>`                | stage UUID from the same pipeline            |
| `--start-date <date>`         | estimated start date (YYYY-MM-DD)            |
| `--target-date <date>`        | estimated completion date (YYYY-MM-DD)       |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
version: string | null
commitSha: string | null
url: string
pipeline: {id: string, name: string, type: string}
stage: {id: string, name: string, type: string, frozen: boolean}
startDate: string | null
targetDate: string | null
startedAt: string | null
completedAt: string | null
canceledAt: string | null
archivedAt: string | null
description: string | null
issueCount: number
```

### `linear release update-version`

Update stage/name/links for an explicit pipeline and release version

```
linear release update-version [options]
```

| Option                        | Description                                                       |
| ----------------------------- | ----------------------------------------------------------------- |
| `--description <text>`        | release description (Markdown)                                    |
| `--description-file <path>`   | read description from file ('-' for stdin)                        |
| `--clear-description`         | clear the description                                             |
| `--pipeline <id\|slug>`       | target pipeline UUID or slug                                      |
| `--release-version <version>` | explicit release version within the pipeline (no latest fallback) |
| `--name <name>`               | release name                                                      |
| `--link <label=url\|url>`     | attach an external link (repeatable)                              |
| `--stage <name>`              | stage name (Linear matches exact name, then normalized name)      |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
version: string | null
commitSha: string | null
url: string
pipeline: {id: string, name: string, type: string}
stage: {id: string, name: string, type: string, frozen: boolean}
startDate: string | null
targetDate: string | null
startedAt: string | null
completedAt: string | null
canceledAt: string | null
archivedAt: string | null
description: string | null
issueCount: number
```

### `linear release view`

Show a release by UUID or slug

```
linear release view [options] <id>
```

**Output (`--json`)**: a bare object

```text
id: string
name: string
version: string | null
commitSha: string | null
url: string
pipeline: {id: string, name: string, type: string}
stage: {id: string, name: string, type: string, frozen: boolean}
startDate: string | null
targetDate: string | null
startedAt: string | null
completedAt: string | null
canceledAt: string | null
archivedAt: string | null
description: string | null
issueCount: number
```
