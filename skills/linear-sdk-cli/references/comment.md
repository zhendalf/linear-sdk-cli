# linear comment

> Manage comments

Group alias: `cm`

_Generated from `linear commands --json`. `linear comment --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear comment`

Manage comments

Aliases: `cm`

```
linear comment [options]
```

### `linear comment add`

Add a comment to an issue (images uploaded with --attach render inline)

Aliases: `create`

```
linear comment add [options] <issue> [body]
```

| Option               | Description                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `--body-file <path>` | read comment body from a file ('-' = stdin)                                               |
| `--mention <user>`   | prepend a real Linear mention (name, email, me, or id; repeatable)                        |
| `--attach <file>`    | upload a file and embed it in the comment (images inline; repeatable; private by default) |
| `--public`           | upload the attachments to public, world-readable URLs (raster images only)                |

**Output (`--json`)**: a receipt object — `attachments` only with --attach

```text
id: string
issue: string
url: string
attachments?: Array<{filename: string, assetUrl: string, contentType: string, size: number}>
```

### `linear comment delete`

Delete a comment

Aliases: `rm`

```
linear comment delete [options] <commentId>
```

**Output (`--json`)**: a receipt object

```text
id: string
deleted: boolean
```

### `linear comment list`

List comments on an issue

Aliases: `ls`

```
linear comment list [options] <issue>
```

**Output (`--json`)**: a bare array of objects

```text
id: string
body: string
user: {id: string, displayName: string} | null
createdAt: string
editedAt: string | null
resolvedAt: string | null
parent: {id: string} | null
url: string
```

### `linear comment reply`

Reply to a comment (nested under it)

```
linear comment reply [options] <commentId> [body]
```

| Option               | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `--body-file <path>` | read reply body from a file ('-' = stdin)                          |
| `--mention <user>`   | prepend a real Linear mention (name, email, me, or id; repeatable) |

**Output (`--json`)**: a receipt object

```text
id: string
parent: string
issue: string | null
url: string
```

### `linear comment resolve`

Resolve a comment thread

```
linear comment resolve [options] <commentId>
```

**Output (`--json`)**: a receipt object

```text
id: string
resolved: boolean
```

### `linear comment unresolve`

Unresolve a comment thread

```
linear comment unresolve [options] <commentId>
```

**Output (`--json`)**: a receipt object

```text
id: string
resolved: boolean
```

### `linear comment update`

Update a comment's body

Aliases: `edit`

```
linear comment update [options] <commentId> [body]
```

| Option               | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `--body-file <path>` | read new body from a file ('-' = stdin)                            |
| `--mention <user>`   | prepend a real Linear mention (name, email, me, or id; repeatable) |

**Output (`--json`)**: a receipt object

```text
id: string
url: string
```
