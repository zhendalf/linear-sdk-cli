# linear favorite

> Manage your favorites

Group alias: `fav`

_Generated from `linear commands --json`. `linear favorite --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear favorite`

Manage your favorites

Aliases: `fav`

```
linear favorite [options]
```

### `linear favorite add`

Favorite an issue, project, or document (exactly one)

Aliases: `new`

```
linear favorite add [options]
```

| Option                 | Description                           |
| ---------------------- | ------------------------------------- |
| `--issue <id>`         | issue id or identifier (e.g. TES-123) |
| `--project <id\|name>` | project name or id                    |
| `--document <id>`      | document id (UUID)                    |

### `linear favorite list`

List your favorites

Aliases: `ls`

```
linear favorite list [options]
```

### `linear favorite remove`

Remove a favorite by id

Aliases: `rm`

```
linear favorite remove [options] <favoriteId>
```
