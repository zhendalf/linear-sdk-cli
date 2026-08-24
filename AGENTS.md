# Repository Guidelines

## Architecture and Layout

This is a Bun-first, strict TypeScript CLI that executes source directly; there is no build step.
`src/bin/linear.ts` is the executable entry point and `src/cli.ts` assembles the Commander command
tree. Keep command parsing and option wiring in `src/commands/`, Linear SDK calls in
`src/services/`, reusable behavior in `src/lib/`, and terminal rendering in `src/output/`.
Cross-cutting configuration, authentication, context, and Git helpers live directly under `src/`.

Tests are organized by purpose: isolated behavior in `test/unit/`, CLI/output contracts in
`test/contract/`, and credentialed workflows in `test/integration/`. The distributable agent skill
lives in `skills/linear-sdk-cli/`. Coverage audit tooling and its checked-in baseline live in
`scripts/`.

## Development Commands

- `bun install` installs dependencies; Bun 1.1 or newer is required.
- `bun run dev -- issue list` runs the CLI from source. `bun run lin -- ...` is an equivalent
  local alias.
- `bun test test/unit/issue-create.test.ts` runs one focused test file.
- `bun run test:unit`, `bun run test:contract`, and `bun run test` run the local test tiers.
- `bun run typecheck`, `bun run lint`, and `bun run format:check` run individual static checks.
- `bun run format` applies Oxfmt formatting.
- `bun run verify` runs type checking, Oxlint, the SDK coverage audit, formatting checks, and all
  unit/contract tests. Run it before handing off changes.
- `bun run test:live` runs credentialed integration tests. `bun run test:live:admin` also enables
  admin-tier mutations. Both require `LINEAR_API_KEY`; do not run them unless live API mutations are
  intended.
- `bun run janitor` removes leaked `clitest-` fixtures from the configured live workspace and also
  requires credentials.

## Generated Artifacts and Coverage

Command references under `skills/linear-sdk-cli/references/` are generated from the live command
tree. After changing commands, options, aliases, or help text, run `bun run skill:docs` and commit
the generated references with the source change; do not hand-edit generated command documentation.

`bun run audit:coverage` refreshes `COVERAGE.md` and checks `scripts/coverage.snapshot.json`. If an
intentional SDK-coverage classification changes, review it and re-baseline explicitly with
`bun run audit:coverage --update`. Never update the snapshot merely to silence unexplained drift.

## Code and Output Contracts

Use two-space indentation, semicolons, double quotes, trailing commas, and a 100-column target.
Use kebab-case filenames, camelCase functions and variables, and PascalCase types. Prefer small
service methods and shared helpers over embedding API or rendering logic in command definitions.

Treat machine output as a public interface. In `--json` mode, stdout must contain only the stable,
parseable JSON result; diagnostics, progress, and warnings belong on stderr. Preserve exit codes,
field selection, non-interactive behavior, and existing output shapes unless the change explicitly
updates that contract. Add or update contract tests for user-visible CLI behavior.

## Testing Expectations

Tests use `bun:test` and filenames end in `*.test.ts`. Add focused regression coverage for behavior
changes: unit tests for isolated logic, contract tests for output/envelope guarantees, and
integration tests only for behavior that requires Linear. Live fixtures must use the shared helpers,
remain gated by `LINEAR_CLI_LIVE` (and `LINEAR_CLI_LIVE_ADMIN` where applicable), and use the
`clitest-` naming convention so cleanup can find them.

## Commits and Pull Requests

Keep changes scoped and preserve unrelated work. History uses concise, imperative Conventional
Commit-style subjects such as `feat:`, `fix:`, `test(live):`, and `docs(parity):`, sometimes ending
with a Linear issue such as `(TES-610)`. Pull requests should explain user-visible CLI behavior,
link the relevant issue, list verification performed, and include help or JSON examples when an
interface changes. Commit generated skill references and coverage artifacts with their source
changes.

## Security and Local Configuration

Never commit API keys, credentials, or machine-local configuration. Use `LINEAR_API_KEY` for
temporary credentialed runs or the OS keyring through `linear auth login`. Project-local
`.linear.toml` files are for non-secret settings only. Avoid printing secrets in diagnostics,
fixtures, snapshots, or test output.
