# linear comment

> Manage comments

Group alias: `cm`

_Generated from `linear commands --json`. `linear comment --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear comment`

Manage comments

Aliases: `cm`

```
linear comment [options]
```

### `linear comment add`

Add a comment to an issue (images uploaded with --attach render inline)

```
linear comment add [options] <issue> [body]
```

| Option               | Description                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `--body-file <path>` | read comment body from a file ('-' = stdin)                                               |
| `--attach <file>`    | upload a file and embed it in the comment (images inline; repeatable; private by default) |
| `--public`           | upload the attachments to public, world-readable URLs (raster images only)                |

### `linear comment delete`

Delete a comment

Aliases: `rm`

```
linear comment delete [options] <commentId>
```

### `linear comment list`

List comments on an issue

Aliases: `ls`

```
linear comment list [options] <issue>
```

### `linear comment reply`

Reply to a comment (nested under it)

```
linear comment reply [options] <commentId> [body]
```

| Option               | Description                               |
| -------------------- | ----------------------------------------- |
| `--body-file <path>` | read reply body from a file ('-' = stdin) |

### `linear comment resolve`

Resolve a comment thread

```
linear comment resolve [options] <commentId>
```

### `linear comment unresolve`

Unresolve a comment thread

```
linear comment unresolve [options] <commentId>
```

### `linear comment update`

Update a comment's body

Aliases: `edit`

```
linear comment update [options] <commentId> [body]
```

| Option               | Description                             |
| -------------------- | --------------------------------------- |
| `--body-file <path>` | read new body from a file ('-' = stdin) |
