# linear release-stage

> Manage release stages and freeze scheduled release scope

_Generated from `linear commands --json`. `linear release-stage --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear release-stage`

Manage release stages and freeze scheduled release scope

```
linear release-stage [options]
```

### `linear release-stage create`

Create a stage in a release pipeline

```
linear release-stage create [options]
```

| Option                  | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `--name <name>`         | stage name                                                   |
| `--color <hex>`         | six-digit HEX color                                          |
| `--position <number>`   | stage ordering position                                      |
| `--frozen <boolean>`    | exclude this started stage from automated sync (true\|false) |
| `--pipeline <id\|slug>` | pipeline UUID or slug                                        |
| `--type <type>`         | lifecycle stage type                                         |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
type: string
color: string
position: number
frozen: boolean
pipeline: {id: string, name: string}
archivedAt: string | null
```

### `linear release-stage list`

List stages for a pipeline UUID or slug

Aliases: `ls`

```
linear release-stage list [options] <pipeline>
```

| Option               | Description             |
| -------------------- | ----------------------- |
| `--include-archived` | include archived stages |

**Output (`--json`)**: a bare array of objects

```text
id: string
name: string
type: string
color: string
position: number
frozen: boolean
pipeline: {id: string, name: string}
archivedAt: string | null
```

### `linear release-stage update`

Update name, color, order, or frozen state by stage UUID

```
linear release-stage update [options] <id>
```

| Option                | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| `--name <name>`       | stage name                                                   |
| `--color <hex>`       | six-digit HEX color                                          |
| `--position <number>` | stage ordering position                                      |
| `--frozen <boolean>`  | exclude this started stage from automated sync (true\|false) |

**Output (`--json`)**: a receipt object

```text
id: string
name: string
type: string
color: string
position: number
frozen: boolean
pipeline: {id: string, name: string}
archivedAt: string | null
```

### `linear release-stage view`

Show a release stage by UUID

```
linear release-stage view [options] <id>
```

**Output (`--json`)**: a bare object

```text
id: string
name: string
type: string
color: string
position: number
frozen: boolean
pipeline: {id: string, name: string}
archivedAt: string | null
```
