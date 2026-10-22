# linear release-note

> Manage Markdown notes covering one or more releases

_Generated from `linear commands --json`. `linear release-note --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear release-note`

Manage Markdown notes covering one or more releases

```
linear release-note [options]
```

### `linear release-note create`

Create a note for explicit releases or an inclusive createdAt range

```
linear release-note create [options]
```

| Option                  | Description                                    |
| ----------------------- | ---------------------------------------------- |
| `--title <title>`       | release note title                             |
| `--body <text>`         | release note body (Markdown)                   |
| `--body-file <path>`    | read Markdown from file ('-' for stdin)        |
| `--release <id>`        | covered release UUID or slug (repeatable)      |
| `--from-release <id>`   | oldest release in an inclusive createdAt range |
| `--to-release <id>`     | newest release in the inclusive range          |
| `--pipeline <id\|slug>` | pipeline UUID or slug                          |

**Output (`--json`)**: a receipt object

```text
id: string
title: string | null
url: string
pipeline: {id: string, name: string}
releaseCount: number
firstRelease: {id: string, name: string} | null
lastRelease: {id: string, name: string} | null
generationStatus: string | null
archivedAt: string | null
content: string | null
```

### `linear release-note delete`

Delete a release note by UUID or slug

```
linear release-note delete [options] <id>
```

**Output (`--json`)**: a receipt object

```text
id: string
deleted: boolean
```

### `linear release-note list`

List release notes with optional pipeline/release filters

Aliases: `ls`

```
linear release-note list [options]
```

| Option                  | Description                            |
| ----------------------- | -------------------------------------- |
| `--pipeline <id\|slug>` | filter by pipeline UUID or slug        |
| `--release <id>`        | filter by covered release UUID or slug |
| `--include-archived`    | include archived notes                 |

**Output (`--json`)**: a bare array of objects

```text
id: string
title: string | null
url: string
pipeline: {id: string, name: string}
releaseCount: number
firstRelease: {id: string, name: string} | null
lastRelease: {id: string, name: string} | null
generationStatus: string | null
archivedAt: string | null
```

### `linear release-note update`

Update a note's title, Markdown, or covered releases

```
linear release-note update [options] <id>
```

| Option                | Description                                    |
| --------------------- | ---------------------------------------------- |
| `--title <title>`     | release note title                             |
| `--body <text>`       | release note body (Markdown)                   |
| `--body-file <path>`  | read Markdown from file ('-' for stdin)        |
| `--release <id>`      | covered release UUID or slug (repeatable)      |
| `--from-release <id>` | oldest release in an inclusive createdAt range |
| `--to-release <id>`   | newest release in the inclusive range          |

**Output (`--json`)**: a receipt object

```text
id: string
title: string | null
url: string
pipeline: {id: string, name: string}
releaseCount: number
firstRelease: {id: string, name: string} | null
lastRelease: {id: string, name: string} | null
generationStatus: string | null
archivedAt: string | null
content: string | null
```

### `linear release-note view`

Show a release note and its Markdown body by UUID or slug

```
linear release-note view [options] <id>
```

**Output (`--json`)**: a bare object

```text
id: string
title: string | null
url: string
pipeline: {id: string, name: string}
releaseCount: number
firstRelease: {id: string, name: string} | null
lastRelease: {id: string, name: string} | null
generationStatus: string | null
archivedAt: string | null
content: string | null
```
