# linear open

> Open the workspace, an issue, team, project, or URL

_Generated from `linear commands --json`. `linear open --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear open`

Open the workspace, an issue, team, project, or URL

```
linear open [options] [target]
```

| Option      | Description                               |
| ----------- | ----------------------------------------- |
| `--app`     | open in Linear.app (macOS)                |
| `-w, --web` | open in the default browser (the default) |

**Output (`--json`)**: a receipt object

```text
target: string
url: string
label: string
opened: boolean
```
