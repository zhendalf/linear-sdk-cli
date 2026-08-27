# linear schema

> Print the Linear GraphQL schema as SDL (--json prints raw introspection)

_Generated from `linear commands --json`. `linear schema --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear schema`

Print the Linear GraphQL schema as SDL (--json prints raw introspection)

```
linear schema [options]
```

| Option                | Description                       |
| --------------------- | --------------------------------- |
| `-o, --output <file>` | write to a file instead of stdout |

**Output (`--json`)**: raw JSON (keys depend on the request) — the GraphQL introspection result ({__schema: …}); with -o <file> it is written there and stdout stays empty
