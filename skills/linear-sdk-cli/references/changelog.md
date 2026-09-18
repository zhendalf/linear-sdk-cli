# linear changelog

> Show recent CLI release notes

_Generated from `linear commands --json`. `linear changelog --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear changelog`

Show recent CLI release notes

```
linear changelog [options]
```

**Output (`--json`)**: a bare array of objects

```text
version: string
date: string
url: string
sections: Array<{title: string, items: string[]}>
```
