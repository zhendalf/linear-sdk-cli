# linear api

> Run a raw GraphQL query or mutation against the Linear API

_Generated from `linear commands --json`. `linear api --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-color`, and `--debug`. Only command-specific options are listed below.

### `linear api`

Run a raw GraphQL query or mutation against the Linear API

```
linear api [options] [query]
```

| Option                | Description                                         |
| --------------------- | --------------------------------------------------- |
| `--query-file <path>` | read the query from a file ('-' for stdin)          |
| `--var <k=v...>`      | set a variable (repeatable; string value)           |
| `--vars <json>`       | variables as a JSON object                          |
| `--vars-file <path>`  | read variables from a JSON file ('-' for stdin)     |
| `--operation <name>`  | operation name for a multi-operation document       |
| `--paginate`          | auto-follow the first connection's pageInfo cursor  |
| `--raw`               | print the full GraphQL response (data + extensions) |
