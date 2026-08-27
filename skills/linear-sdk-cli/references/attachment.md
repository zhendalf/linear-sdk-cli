# linear attachment

> Work with issue attachments

Group alias: `at`

_Generated from `linear commands --json`. `linear attachment --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear attachment`

Work with issue attachments

Aliases: `at`

```
linear attachment [options]
```

### `linear attachment create`

Attach a URL to an issue

Aliases: `new`

```
linear attachment create [options] <issue>
```

| Option              | Description         |
| ------------------- | ------------------- |
| `--url <url>`       | the URL to attach   |
| `--title <title>`   | attachment title    |
| `--subtitle <text>` | attachment subtitle |

**Output (`--json`)**: a receipt object

```text
id: string
title: string
url: string
```

### `linear attachment delete`

Delete an attachment by id

Aliases: `rm`

```
linear attachment delete [options] <id>
```

**Output (`--json`)**: a receipt object

```text
id: string
title: string
deleted: boolean
```

### `linear attachment list`

List the attachments on an issue

Aliases: `ls`

```
linear attachment list [options] <issue>
```

**Output (`--json`)**: a bare array of objects

```text
id: string
title: string
subtitle: string | null
url: string
source: string | null
createdAt: string
```
