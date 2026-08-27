# linear whoami

> Show the authenticated user

_Generated from `linear commands --json`. `linear whoami --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear whoami`

Show the authenticated user

```
linear whoami [options]
```

**Output (`--json`)**: a bare object

```text
id: string
name: string
displayName: string
email: string
admin: boolean
organization: {id: string, name: string, urlKey: string}
```
