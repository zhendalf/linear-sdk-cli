# linear webhook

> Manage workspace webhooks

Group alias: `wh`

_Generated from `linear commands --json`. `linear webhook --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear webhook`

Manage workspace webhooks

Aliases: `wh`

```
linear webhook [options]
```

### `linear webhook create`

Create a webhook (scope to the global --team, or --all-public)

Aliases: `new`

```
linear webhook create [options]
```

| Option                 | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `--url <url>`          | destination URL that receives event payloads   |
| `--resource <type...>` | resource type to subscribe to (repeatable)     |
| `--label <label>`      | human-readable label for the webhook           |
| `--all-public`         | subscribe to all public teams in the workspace |
| `--secret <secret>`    | secret used to sign webhook payloads           |

### `linear webhook delete`

Delete a webhook

Aliases: `rm`

```
linear webhook delete [options] <id>
```

### `linear webhook list`

List webhooks

Aliases: `ls`

```
linear webhook list [options]
```

### `linear webhook update`

Update a webhook

Aliases: `edit`

```
linear webhook update [options] <id>
```

| Option                 | Description                     |
| ---------------------- | ------------------------------- |
| `--url <url>`          | new destination URL             |
| `--enabled`            | enable the webhook              |
| `--disabled`           | disable the webhook             |
| `--resource <type...>` | set resource types (repeatable) |
| `--label <label>`      | new label                       |
| `--secret <secret>`    | new signing secret              |

### `linear webhook view`

Show a webhook

Aliases: `show`

```
linear webhook view [options] <id>
```
