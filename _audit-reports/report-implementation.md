## Verdict

- The core commands → services → SDK structure is sound for most CRUD paths, but `api`, `schema`, and `meta` bypass it, and one bypass directly caused a real v89 incompatibility. [src/commands/api.ts:59-60](/Users/z/code/linear-sdk-cli/src/commands/api.ts:59) [src/commands/meta.ts:27-76](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:27)

- The most dangerous defect is `linear api --paginate`: it can repeat an arbitrary GraphQL mutation once per page, creating duplicate entities. [src/commands/api.ts:123-149](/Users/z/code/linear-sdk-cli/src/commands/api.ts:123)

- Mutation success handling is not trustworthy. Several commands can exit zero and report success after a type-valid `{success:false}` payload. [src/services/issue.ts:428-430](/Users/z/code/linear-sdk-cli/src/services/issue.ts:428) [src/services/notification.ts:92-125](/Users/z/code/linear-sdk-cli/src/services/notification.ts:92)

- Pagination is broadly implemented, but boundary correctness is uneven: fixed resolver caps cause false `not_found`, embedded connections are silently partial, and milestone truncation can explicitly lie. [src/lib/resolve.ts:41-46](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:41) [src/services/milestone.ts:78-104](/Users/z/code/linear-sdk-cli/src/services/milestone.ts:78)

- Filter builders contain real semantic errors: project status names target the deprecated field, label filtering is case-sensitive, and state aliases can override exact custom names. [src/services/project.ts:49-64](/Users/z/code/linear-sdk-cli/src/services/project.ts:49) [src/services/issue.ts:129-144](/Users/z/code/linear-sdk-cli/src/services/issue.ts:129)

- Credential selection correctly excludes valid project-file keys, but malformed TOML can disclose a key, login can store a valid key under the wrong workspace, and writes are non-atomic. [src/config.ts:101-113](/Users/z/code/linear-sdk-cli/src/config.ts:101) [src/commands/meta.ts:65-76](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:65) [src/config.ts:279-301](/Users/z/code/linear-sdk-cli/src/config.ts:279)

- TypeScript is configured strictly, but pervasive `any` casts make that protection largely porous at the SDK boundary. The dead `--operation` flag is direct evidence, not a theoretical complaint. [tsconfig.json:2-17](/Users/z/code/linear-sdk-cli/tsconfig.json:2) [eslint.config.js:8-16](/Users/z/code/linear-sdk-cli/eslint.config.js:8)

- The test suite is broad but too happy-path and mock-centric. Several tests actually lock in faulty filter shapes or return payloads the real SDK does not produce. [test/unit/project.test.ts:23-33](/Users/z/code/linear-sdk-cli/test/unit/project.test.ts:23) [test/unit/issue-filter.test.ts:40-48](/Users/z/code/linear-sdk-cli/test/unit/issue-filter.test.ts:40)

- Keep OURS’ service layer, but steal THEIRS’ generated GraphQL document types and local transport-level test harness. [linear-cli-reference/codegen.ts:3-33](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/codegen.ts:3) [linear-cli-reference/test/utils/mock_linear_server.ts:94-164](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/test/utils/mock_linear_server.ts:94)

## Confirmed bugs

### 1. `api --paginate` can repeat mutations

- **Severity:** Critical

- **What breaks:** Pagination reruns the complete GraphQL document for every cursor without checking the selected operation’s kind.

- **Failure scenario:** Run a create mutation that returns a nested connection with `first: 1` and `hasNextPage: true`. Page two reruns the create mutation, producing a second entity; further pages can produce further duplicates.

- **Location:** Arbitrary queries and mutations accept `--paginate` at [src/commands/api.ts:22-30](/Users/z/code/linear-sdk-cli/src/commands/api.ts:22); dispatch performs no operation-kind validation at [src/commands/api.ts:47-55](/Users/z/code/linear-sdk-cli/src/commands/api.ts:47); the whole document is rerun at [src/commands/api.ts:123-149](/Users/z/code/linear-sdk-cli/src/commands/api.ts:123).

- **Fix:** Parse the document using `graphql`, select the named/default operation, and reject pagination for mutation and subscription operations.

### 2. A key can be stored under the wrong workspace and later mutate the wrong organization

- **Severity:** High

- **What breaks:** `auth login` fetches the key’s real `organization.urlKey`, but an arbitrary `--workspace` replaces it without validation.

- **Failure scenario:** `linear auth login --workspace org-b --key <org-a-key>` overwrites the `org-b` entry with an org-A key. Later, `linear --workspace org-b issue update ...` silently acts in org A.

- **Location:** The organization is validated at [src/commands/meta.ts:65-74](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:65), but the unchecked flag wins at [src/commands/meta.ts:75-76](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:75), and `writeCredential` overwrites the selected entry at [src/config.ts:295-301](/Users/z/code/linear-sdk-cli/src/config.ts:295).

- **Fix:** Require `--workspace === org.urlKey`. If aliases are intentional, rename the concept to “profile” and persist the validated organization ID and slug alongside it.

### 3. Failed mutations can be reported as successful

- **Severity:** High

- **What breaks:** Multiple services either ignore `payload.success` or replace a missing updated entity with the pre-mutation entity.

- **Failure scenario:** A valid issue payload `{success:false, issue:null}` causes `updateIssue` to return the old issue, after which the command prints `Updated TES-1` and exits zero. Similarly, notification read/snooze commands discard `success:false`, while `read-all` ignores every update result and unconditionally returns `{success:true}`.

- **Location:** Issue fallback at [src/services/issue.ts:428-430](/Users/z/code/linear-sdk-cli/src/services/issue.ts:428), success output at [src/commands/issue.ts:258-277](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:258), notification handling at [src/services/notification.ts:92-125](/Users/z/code/linear-sdk-cli/src/services/notification.ts:92) and [src/commands/notification.ts:38-99](/Users/z/code/linear-sdk-cli/src/commands/notification.ts:38). SDK v89 explicitly types nullable `issue` separately from `success` at [node_modules/@linear/sdk/dist/index-DHA7xCPn.d.mts:10598-10606](/Users/z/code/linear-sdk-cli/node_modules/@linear/sdk/dist/index-DHA7xCPn.d.mts:10598).

- **Fix:** Add a typed `assertMutationSuccess`/`unwrapMutation` helper. Require `success === true`, require the entity where appropriate, and never substitute stale pre-mutation data.

THEIRS handles this better by checking both success and entity presence. [linear-cli-reference/src/commands/issue/issue-update.ts:303-315](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/src/commands/issue/issue-update.ts:303)

### 4. Malformed config can disclose API keys and emit terminal control bytes

- **Severity:** High

- **What breaks:** The raw TOML parser message is embedded verbatim in a CLI error. `smol-toml` includes the offending source line.

- **Failure scenario:** A malformed user line such as `api_key = "lin_api_SECRET` prints the full key to stderr. A repository-controlled malformed `.linear.toml` can similarly include ANSI or OSC bytes in human-mode error output.

- **Location:** Raw parser message propagation at [src/config.ts:89-97](/Users/z/code/linear-sdk-cli/src/config.ts:89), unconditional project parsing at [src/config.ts:168-177](/Users/z/code/linear-sdk-cli/src/config.ts:168), and unsanitized human output at [src/output/format.ts:82-94](/Users/z/code/linear-sdk-cli/src/output/format.ts:82).

- **Fix:** Emit only sanitized path, reason, line, and column. Strip control characters and never include source excerpts from credential-bearing files.

### 5. Filter builders return the wrong project and issue sets

- **Severity:** Medium

- **What breaks:**
  - Project `--state <name>` filters deprecated `Project.state` instead of `status.name`.
  - Issue labels use case-sensitive `name.in`.
  - A canonical type token such as `Started` wins before an exact custom workflow-state name is considered.

- **Failure scenarios:**
  - A custom project status named `In QA` produces no results because `state` contains the coarse legacy status group.
  - A stored label `bug` is missed by `--label Bug`.
  - A custom state literally named `Started` with type `unstarted` makes `--state Started` return all `started`-type issues instead.

- **Location:** Project filter at [src/services/project.ts:49-64](/Users/z/code/linear-sdk-cli/src/services/project.ts:49); the current schema marks `state` deprecated and exposes `status` at [linear-cli-reference/graphql/schema.graphql:26366-26370](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/graphql/schema.graphql:26366); issue state/label filters at [src/services/issue.ts:129-144](/Users/z/code/linear-sdk-cli/src/services/issue.ts:129).

- **Fix:** Filter project statuses through `status.name.eqIgnoreCase` or resolve a status ID. Make issue label comparisons case-insensitive. Resolve a state name before falling back to type aliases, matching `resolveStateId`’s name-first behavior.

THEIRS correctly uses `status.name` and case-insensitive per-label filters. [linear-cli-reference/src/commands/project/project-list.ts:114-123](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/src/commands/project/project-list.ts:114) [linear-cli-reference/src/utils/linear.ts:578-586](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/src/utils/linear.ts:578)

### 6. `api --operation` is a no-op

- **Severity:** Medium

- **What breaks:** The option is accepted but never reaches the HTTP request body.

- **Failure scenario:** A two-operation document invoked with `--operation ReadIssues` is still sent without `operationName`, so GraphQL rejects it as ambiguous.

- **Location:** The flag is registered at [src/commands/api.ts:22-30](/Users/z/code/linear-sdk-cli/src/commands/api.ts:22), then passed as a fourth `rawRequest` argument at [src/commands/api.ts:59-60](/Users/z/code/linear-sdk-cli/src/commands/api.ts:59) and [src/commands/api.ts:135-138](/Users/z/code/linear-sdk-cli/src/commands/api.ts:135). SDK v89 accepts only three arguments and serializes only `query` and `variables`. [node_modules/@linear/sdk/dist/index.d.mts:117-125](/Users/z/code/linear-sdk-cli/node_modules/@linear/sdk/dist/index.d.mts:117) [node_modules/@linear/sdk/dist/index.mjs:1348-1363](/Users/z/code/linear-sdk-cli/node_modules/@linear/sdk/dist/index.mjs:1348)

- **Fix:** Use a transport capable of sending `operationName`, or AST-select the requested operation plus its referenced fragments into a single-operation document.

### 7. Malformed numeric input silently becomes a different mutation or filter

- **Severity:** Medium

- **What breaks:** `Number.parseInt` accepts numeric prefixes.

- **Failure scenario:** `--priority 1.9` mutates priority to `1`; `--estimate 2junk` stores estimate `2`; `--cycle 12garbage` resolves cycle 12; issue list priority `"2oops"` becomes `2`.

- **Location:** Shared parser at [src/lib/options.ts:33-36](/Users/z/code/linear-sdk-cli/src/lib/options.ts:33), cycle resolver at [src/lib/resolve.ts:227-244](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:227), issue filter at [src/services/issue.ts:139-144](/Users/z/code/linear-sdk-cli/src/services/issue.ts:139), and mutation wiring at [src/commands/issue.ts:167-172](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:167).

- **Fix:** Require a complete integer token, then apply field-specific constraints: priority 0–4 and an explicit estimate policy.

### 8. Fixed resolver page caps cause false `not_found` or incorrect ambiguity

- **Severity:** Medium

- **What breaks:** Several name resolvers inspect only the first connection page.

- **Failure scenarios:**
  - A matching team at position 251 is reported missing.
  - A milestone at position 101 in a project is reported missing.
  - Fifty same-name labels from other teams can fill the first page, hiding the matching team-scoped label on page two.

- **Location:** Team cap at [src/lib/resolve.ts:41-46](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:41), issue-label cap and post-query team scoping at [src/lib/resolve.ts:105-119](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:105), milestone cap at [src/lib/resolve.ts:247-260](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:247).

- **Fix:** Prefer server-side ID/name/team filters. Where client-side scoping remains necessary, exhaust the connection before deciding `not_found` or ambiguity.

### 9. Detail and row outputs silently truncate embedded connections

- **Severity:** Medium

- **What breaks:** Nested relations are emitted as apparently complete arrays without following their cursors or exposing truncation.

- **Failure scenarios:**
  - Issue list/search returns only the first 20 labels.
  - Issue detail omits subscribers beyond the SDK’s default page.
  - Project detail omits members or labels beyond the first page.
  - A roadmap with 101 projects reports only 100.

- **Location:** Issue row queries and mapping at [src/services/issue.ts:100-110](/Users/z/code/linear-sdk-cli/src/services/issue.ts:100), [src/services/issue.ts:197-207](/Users/z/code/linear-sdk-cli/src/services/issue.ts:197), and [src/services/issue.ts:245-260](/Users/z/code/linear-sdk-cli/src/services/issue.ts:245); issue detail at [src/services/issue.ts:287-322](/Users/z/code/linear-sdk-cli/src/services/issue.ts:287); project detail at [src/services/project.ts:118-149](/Users/z/code/linear-sdk-cli/src/services/project.ts:118); roadmap cap at [src/services/roadmap.ts:58-81](/Users/z/code/linear-sdk-cli/src/services/roadmap.ts:58).

- **Fix:** Paginate relations with `collect`. For deliberately capped nested data, return an explicit `truncated` field rather than presenting the array as complete.

### 10. Milestone detail can say `issuesTruncated:false` after truncating issues

- **Severity:** Medium

- **What breaks:** `collect` fetches a full next page and slices to `limit`, while SDK `fetchNext()` mutates the original connection’s `pageInfo`. The later truncation check therefore sees the final `hasNextPage:false`.

- **Failure scenario:** A milestone has 180 issues and `--limit 150`. The CLI returns 150 issues but says `issuesTruncated:false`.

- **Location:** Collection and slicing at [src/lib/pagination.ts:16-25](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:16); truncation is calculated after collection at [src/services/milestone.ts:78-104](/Users/z/code/linear-sdk-cli/src/services/milestone.ts:78); SDK mutation behavior is visible at [node_modules/@linear/sdk/dist/index.mjs:70134-70163](/Users/z/code/linear-sdk-cli/node_modules/@linear/sdk/dist/index.mjs:70134).

- **Fix:** Request `limit + 1`, or capture “more existed” before fetching/slicing. Return the first `limit` and set truncation from the extra item.

### 11. Sorting after applying `limit` selects the wrong subset

- **Severity:** Medium

- **What breaks:** State and cycle services fetch only `limit` items, then sort that partial set by a different field than the server pagination order.

- **Failure scenario:** State positions arrive `[3,1,2]`; `--limit 2` returns `[1,3]`, not global positions `[1,2]`. Cycles `[#1,#10,#9]` with limit 2 return `[#10,#1]`, omitting #9.

- **Location:** State path at [src/services/state.ts:23-34](/Users/z/code/linear-sdk-cli/src/services/state.ts:23), duplicate team-state path at [src/services/team.ts:118-135](/Users/z/code/linear-sdk-cli/src/services/team.ts:118), cycle path at [src/services/cycle.ts:24-38](/Users/z/code/linear-sdk-cli/src/services/cycle.ts:24). The schema says these connections paginate by `createdAt`/`updatedAt`, not position or cycle number. [linear-cli-reference/graphql/schema.graphql:35874-35901](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/graphql/schema.graphql:35874)

- **Fix:** Use compatible server-side ordering if available; otherwise exhaust, sort globally, then slice.

### 12. Concurrent credential writes can silently lose work

- **Severity:** Medium

- **What breaks:** Credential operations perform unlocked read-modify-write and overwrite the live file directly.

- **Failure scenario:** Two concurrent logins read the same config, each adds a different workspace, and the later write erases the first addition. A crash during the direct write can truncate the credential store.

- **Location:** Direct persistence at [src/config.ts:279-284](/Users/z/code/linear-sdk-cli/src/config.ts:279); read-modify-write callers at [src/config.ts:295-318](/Users/z/code/linear-sdk-cli/src/config.ts:295) and [src/config.ts:326-342](/Users/z/code/linear-sdk-cli/src/config.ts:326).

- **Fix:** Lock credential mutations, write a mode-0600 temporary sibling, fsync, and atomically rename.

### 13. Catch-all error rewriting produces false diagnoses

- **Severity:** Medium

- **What breaks:** Unrelated operational failures are rewritten as authentication or not-found errors.

- **Failure scenarios:**
  - DNS, timeout, 429, or Linear 5xx during login becomes “That API key was rejected”.
  - A rate-limit or authorization error resolving a document slug becomes “No document matching”.
  - A failed webhook lookup during deletion becomes “No webhook matching”.

- **Location:** Login catch-all at [src/commands/meta.ts:65-74](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:65), document resolver at [src/services/document.ts:194-201](/Users/z/code/linear-sdk-cli/src/services/document.ts:194), webhook deletion at [src/services/webhook.ts:159-164](/Users/z/code/linear-sdk-cli/src/services/webhook.ts:159).

- **Fix:** Normalize the original error and rewrite only an actual `auth` or `not_found` classification. Login validation should also use `withRetry`.

### 14. Typed SDK pagination retries page one but not subsequent pages

- **Severity:** Medium

- **What breaks:** Callers wrap the initial connection request in `withRetry`, but `collect` invokes `fetchNext()` directly.

- **Failure scenario:** Page two receives a transient rate limit that would succeed on retry. Raw-query pagination retries it; typed pagination fails the entire command immediately.

- **Location:** Unwrapped fetch at [src/lib/pagination.ts:16-25](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:16), versus retrying every raw page at [src/lib/pagination.ts:68-80](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:68).

- **Fix:** Wrap `conn.fetchNext()` in `withRetry`, and test a transient page-two failure.

### 15. `issue view --web` reports success when no browser opened

- **Severity:** Low

- **What breaks:** `openUrl` discards the child-process error and always resolves.

- **Failure scenario:** Missing `xdg-open`, a headless opener failure, or the current Windows `start` invocation fails, but JSON still contains `opened:true`.

- **Location:** Success emission at [src/commands/issue.ts:65-72](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:65); swallowed callback error at [src/commands/issue.ts:685-688](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:685).

- **Fix:** Reject on spawn/nonzero error and use a correct Windows launcher.

### 16. `schema --json --output` ignores the output path

- **Severity:** Low

- **What breaks:** `--output` promises file output, but JSON mode returns before file writing.

- **Failure scenario:** `linear schema --json --output schema.json` writes JSON to stdout and creates no file.

- **Location:** Option registration at [src/commands/discover.ts:55-60](/Users/z/code/linear-sdk-cli/src/commands/discover.ts:55), early JSON return at [src/commands/discover.ts:79-82](/Users/z/code/linear-sdk-cli/src/commands/discover.ts:79), SDL-only file branch at [src/commands/discover.ts:85-90](/Users/z/code/linear-sdk-cli/src/commands/discover.ts:85).

- **Fix:** Serialize the selected representation first, then consistently route it to the file or stdout.

### 17. Common `$EDITOR` values with arguments fail

- **Severity:** Low

- **What breaks:** The entire environment value is treated as one executable filename.

- **Failure scenario:** `EDITOR='code --wait'` attempts to launch an executable literally named `code --wait`.

- **Location:** [src/lib/body.ts:49-56](/Users/z/code/linear-sdk-cli/src/lib/body.ts:49).

- **Fix:** Parse a safely defined editor argv format without invoking a shell, or provide separate executable and argument settings.

### 18. Project detail collapses empty strings into `null`

- **Severity:** Low

- **What breaks:** Empty description/content and absent description/content become indistinguishable in JSON.

- **Failure scenario:** A deliberately cleared project body stored as `""` is emitted as `null`.

- **Location:** [src/services/project.ts:128-133](/Users/z/code/linear-sdk-cli/src/services/project.ts:128).

- **Fix:** Replace `|| null` with `?? null` and remove the unnecessary `content` cast.

## Unconfirmed suspicions

- `withRetry` treats non-idempotent creates exactly like reads. An ambiguous rate-limit/network failure delivered after server-side commit could replay a create, but I did not confirm Linear can produce that ordering. [src/client.ts:25-45](/Users/z/code/linear-sdk-cli/src/client.ts:25)

- Repeated issue labels currently mean “any label”, while THEIRS requires all supplied labels. The CLI does not state the intended conjunction clearly enough to call OURS definitively wrong. [src/services/issue.ts:139-141](/Users/z/code/linear-sdk-cli/src/services/issue.ts:139) [linear-cli-reference/src/utils/linear.ts:578-586](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/src/utils/linear.ts:578)

- `listProjects` sends `filter:{}` while issue search deliberately omits an empty filter. I did not verify whether Linear currently distinguishes `{}` from `null` for `projects`. [src/services/project.ts:67-79](/Users/z/code/linear-sdk-cli/src/services/project.ts:67) [src/services/issue.ts:229-238](/Users/z/code/linear-sdk-cli/src/services/issue.ts:229)

- UUID fast paths bypass scoping and existence checks. This is probably acceptable as an expert escape hatch, but it means state, cycle, milestone, and label IDs are not locally checked against the target team/project. [src/lib/resolve.ts:76-78](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:76) [src/lib/resolve.ts:233-255](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:233)

- `resolveLabelIds` does not distinguish assignable labels from label groups, while `label create --parent` reuses the same resolver without requiring a group parent. I expect backend validation, but did not prove the exact v89 failure behavior. [src/lib/resolve.ts:94-130](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:94) [src/services/label.ts:101-104](/Users/z/code/linear-sdk-cli/src/services/label.ts:101)

- `collectRawQuery` assumes that an existing connection always has nodes and that `hasNextPage` always carries a changing `endCursor`. A malformed response could throw a raw `TypeError` or repeat pages, but valid Relay responses should prevent this. [src/lib/pagination.ts:68-81](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:68)

- `Retry-After` supports an HTTP-date form, but the client only parses numeric seconds. I did not confirm which form Linear sends. [src/client.ts:48-54](/Users/z/code/linear-sdk-cli/src/client.ts:48)

## Architecture & layering

The advertised layering holds for most curated domain operations: commands gather options and delegate, while services own SDK traversal and mutations. Cycle and project are representative. [src/commands/cycle.ts:23-56](/Users/z/code/linear-sdk-cli/src/commands/cycle.ts:23) [src/commands/project.ts:27-61](/Users/z/code/linear-sdk-cli/src/commands/project.ts:27)

It does not hold absolutely:

- `meta.ts` imports and constructs `LinearClient`, reads `viewer`/`organization`, and implements auth validation directly. [src/commands/meta.ts:6-18](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:6) [src/commands/meta.ts:27-76](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:27)

- `api.ts` and `discover.ts` access `ctx.client.client.rawRequest` directly. Low-level access is appropriate to their purpose, but it should live behind a shared transport abstraction so operation selection, retries, and tests are consistent. [src/commands/api.ts:43-68](/Users/z/code/linear-sdk-cli/src/commands/api.ts:43) [src/commands/discover.ts:71-88](/Users/z/code/linear-sdk-cli/src/commands/discover.ts:71)

- `issue.ts` contains significant Git/GitHub/browser orchestration and rendering. This is not SDK leakage, but the command is no longer thin. [src/commands/issue.ts:361-469](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:361) [src/commands/issue.ts:594-625](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:594)

The raw-query/SDK split is defensible where tailored projections avoid N+1 access: issue rows inline state, assignee, project, and labels; notification rows need union-specific relations. [src/services/issue.ts:100-110](/Users/z/code/linear-sdk-cli/src/services/issue.ts:100) [src/services/notification.ts:27-41](/Users/z/code/linear-sdk-cli/src/services/notification.ts:27)

It becomes ad hoc where:

- `collectRawQuery` erases document, variables, connection, and node types. [src/lib/pagination.ts:34-75](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:34)

- Comment listing implements another hand-written pagination loop rather than using the shared helper. [src/services/comment.ts:27-68](/Users/z/code/linear-sdk-cli/src/services/comment.ts:27)

- Initiative list uses raw GraphQL for mostly scalar output while comparable simple services use typed SDK connections. [src/services/initiative.ts:49-79](/Users/z/code/linear-sdk-cli/src/services/initiative.ts:49) [src/services/roadmap.ts:36-41](/Users/z/code/linear-sdk-cli/src/services/roadmap.ts:36)

THEIRS’ organization is worse for separation—commands perform validation, GraphQL, transformation, and output together—but better for query type safety. Its generated documents use strict scalar mappings and make operation result/input types compiler-visible. [linear-cli-reference/codegen.ts:3-33](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/codegen.ts:3) [linear-cli-reference/src/commands/project/project-list.ts:16-58](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/src/commands/project/project-list.ts:16)

The right hybrid is OURS’ service boundary plus generated types for every bespoke raw document.

## Duplication & consistency

- Comments are implemented twice. `issue comments` returns `{user}` without URL; top-level `comment list` returns `{author,url}`. Equivalent operations therefore have incompatible JSON. [src/services/issue.ts:453-473](/Users/z/code/linear-sdk-cli/src/services/issue.ts:453) [src/services/comment.ts:19-25](/Users/z/code/linear-sdk-cli/src/services/comment.ts:19) [src/services/comment.ts:41-68](/Users/z/code/linear-sdk-cli/src/services/comment.ts:41)

- Workflow-state listing is duplicated almost verbatim, including the selection-before-sort bug. [src/services/state.ts:23-34](/Users/z/code/linear-sdk-cli/src/services/state.ts:23) [src/services/team.ts:118-135](/Users/z/code/linear-sdk-cli/src/services/team.ts:118)

- Cycle behavior diverges: standalone cycles sort descending, while `team cycles` preserves API order. [src/services/cycle.ts:24-38](/Users/z/code/linear-sdk-cli/src/services/cycle.ts:24) [src/services/team.ts:164-179](/Users/z/code/linear-sdk-cli/src/services/team.ts:164)

- Mutation unwrapping ranges from correctly checking `success`, to merely requiring an entity, to returning stale data. [src/services/comment.ts:118-121](/Users/z/code/linear-sdk-cli/src/services/comment.ts:118) [src/services/project.ts:231-236](/Users/z/code/linear-sdk-cli/src/services/project.ts:231) [src/services/issue.ts:428-430](/Users/z/code/linear-sdk-cli/src/services/issue.ts:428)

- Priority validation is duplicated in project and initiative, but absent from issue mutations. [src/services/project.ts:305-313](/Users/z/code/linear-sdk-cli/src/services/project.ts:305) [src/services/initiative.ts:25-31](/Users/z/code/linear-sdk-cli/src/services/initiative.ts:25) [src/services/issue.ts:349-352](/Users/z/code/linear-sdk-cli/src/services/issue.ts:349)

- Date normalization is duplicated between attachment and cycle services. [src/services/attachment.ts:91-95](/Users/z/code/linear-sdk-cli/src/services/attachment.ts:91) [src/services/cycle.ts:180-184](/Users/z/code/linear-sdk-cli/src/services/cycle.ts:180)

- `promptSelect` and its import have no caller; `api.paginate` assigns `firstData` but never uses it. [src/lib/prompt.ts:7-45](/Users/z/code/linear-sdk-cli/src/lib/prompt.ts:7) [src/commands/api.ts:129-140](/Users/z/code/linear-sdk-cli/src/commands/api.ts:129)

A good counterexample is `src/lib/status-update.ts`: it successfully shares flags, columns, and row normalization across project and initiative updates, although its payload typing remains weak. [src/lib/status-update.ts:28-64](/Users/z/code/linear-sdk-cli/src/lib/status-update.ts:28)

## Types

The nominal compiler posture is strong: `strict`, `noUncheckedIndexedAccess`, and `noImplicitOverride` are enabled. Explicit `any`, however, is deliberately allowed by lint. [tsconfig.json:2-17](/Users/z/code/linear-sdk-cli/tsconfig.json:2) [eslint.config.js:8-16](/Users/z/code/linear-sdk-cli/eslint.config.js:8)

The weakest boundaries are:

- Mutation inputs are built as `Record<string, any>` despite v89 exporting exact `IssueCreateInput`, `IssueUpdateInput`, `ProjectCreateInput`, and related types. [src/services/issue.ts:342-366](/Users/z/code/linear-sdk-cli/src/services/issue.ts:342) [src/services/project.ts:169-189](/Users/z/code/linear-sdk-cli/src/services/project.ts:169)

- Filters are untyped objects, so comparator and field selection cannot be checked. [src/services/issue.ts:114-160](/Users/z/code/linear-sdk-cli/src/services/issue.ts:114) [src/services/project.ts:49-64](/Users/z/code/linear-sdk-cli/src/services/project.ts:49)

- Initiative/project-label resolvers cast the client to `any` even though v89 types both methods. [src/lib/resolve.ts:143-187](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:143) [node_modules/@linear/sdk/dist/index.d.mts:26838](/Users/z/code/linear-sdk-cli/node_modules/@linear/sdk/dist/index.d.mts:26838)

- Raw transforms accept arbitrary nodes, so a renamed or omitted GraphQL field compiles and becomes `undefined` output. [src/lib/pagination.ts:56-75](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:56)

- `normalizeUpdatePayload(payload:any, payloadKey:string)` loses the relationship between the selected field and payload type. [src/lib/status-update.ts:36-55](/Users/z/code/linear-sdk-cli/src/lib/status-update.ts:36)

- Unnecessary model casts remain for project content and milestone status. [src/services/project.ts:128-133](/Users/z/code/linear-sdk-cli/src/services/project.ts:128) [src/services/milestone.ts:91-100](/Users/z/code/linear-sdk-cli/src/services/milestone.ts:91)

The `--operation` defect is the clearest proof of harm: without `as any`, TypeScript would have rejected the unsupported fourth `rawRequest` argument. [src/commands/api.ts:59-60](/Users/z/code/linear-sdk-cli/src/commands/api.ts:59)

## Tests

Verification during this audit:

- `bun run typecheck` and `bun run lint` passed.

- Ninety-two targeted unit/contract tests across pagination, options, issue/project filters, state, cycle, milestone, notifications, API, and JSON output passed.

- I did not run the live suite because it is credential-gated and performs real workspace mutations and cleanup. [test/integration/_helpers.ts:18-22](/Users/z/code/linear-sdk-cli/test/integration/_helpers.ts:18) [test/integration/issue.test.ts:7-28](/Users/z/code/linear-sdk-cli/test/integration/issue.test.ts:7)

The principal gaps are not test count but fidelity and adversarial coverage:

- API tests exercise only `findConnection`; neither operation selection nor paginated execution is invoked. Both `api` bugs should have been caught here. [test/unit/api.test.ts:1-18](/Users/z/code/linear-sdk-cli/test/unit/api.test.ts:1)

- `parseIntOption` tests `42` and `abc`, but omit decimals and trailing junk—even though the strict limit parser tests those exact cases. [test/unit/options.test.ts:39-63](/Users/z/code/linear-sdk-cli/test/unit/options.test.ts:39)

- Project tests explicitly lock in the deprecated `state.eq` filter. Issue tests similarly lock in case-sensitive `name.in` instead of testing behavior against realistic data. [test/unit/project.test.ts:23-33](/Users/z/code/linear-sdk-cli/test/unit/project.test.ts:23) [test/unit/issue-filter.test.ts:40-48](/Users/z/code/linear-sdk-cli/test/unit/issue-filter.test.ts:40)

- Resolver tests cover only UUID detection and basic team/user/issue paths. State, label, project, cycle, milestone, initiative-label, project-label, ambiguity, scoping, and page-two behavior are absent. [test/unit/resolve.test.ts:1-92](/Users/z/code/linear-sdk-cli/test/unit/resolve.test.ts:1)

- State/team tests provide one complete page with a generous limit, so they cannot reveal selection-before-sort. [test/unit/state.test.ts:22-38](/Users/z/code/linear-sdk-cli/test/unit/state.test.ts:22) [test/unit/team.test.ts:75-89](/Users/z/code/linear-sdk-cli/test/unit/team.test.ts:75)

- Milestone tests return a new connection from `fetchNext`; the real SDK mutates the same connection. That mock difference hides the false truncation flag. [test/unit/milestone.test.ts:103-151](/Users/z/code/linear-sdk-cli/test/unit/milestone.test.ts:103)

- Notification tests return only `success:true`. No false-payload path is tested. [test/unit/notification.test.ts:97-156](/Users/z/code/linear-sdk-cli/test/unit/notification.test.ts:97)

- The issue-update mock omits the SDK-required `success` field, exactly masking the stale-success defect. [test/unit/issue-filter.test.ts:170-190](/Users/z/code/linear-sdk-cli/test/unit/issue-filter.test.ts:170)

- Some mocks produce SDK-impossible shapes: organization users include an inactive user without requesting `includeDisabled`, and cycle formatting passes `undefined as any` to a parameter typed `number`. [test/unit/organization.test.ts:48-62](/Users/z/code/linear-sdk-cli/test/unit/organization.test.ts:48) [test/unit/cycle.test.ts:44-53](/Users/z/code/linear-sdk-cli/test/unit/cycle.test.ts:44)

- The sole contract test calls `Output` directly. It proves renderer envelopes, not command parsing, SDK input construction, exit codes, or accidental output. [test/contract/json-envelope.test.ts:29-73](/Users/z/code/linear-sdk-cli/test/contract/json-envelope.test.ts:29)

THEIRS’ local GraphQL server is the best test strategy to copy: it sees the actual serialized document and variables and rejects unconfigured requests. [linear-cli-reference/test/utils/mock_linear_server.ts:94-164](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/test/utils/mock_linear_server.ts:94)

## Security & robustness

Positive findings:

- A valid project `.linear.toml` cannot select or supply the API key; selection is flag → environment → user credential workspace. [src/config.ts:179-231](/Users/z/code/linear-sdk-cli/src/config.ts:179) [test/unit/config.test.ts:48-72](/Users/z/code/linear-sdk-cli/test/unit/config.test.ts:48)

- Normal auth/config output redacts keys, while `auth token` is explicitly documented in code as the intentional secret-output path. [src/commands/meta.ts:124-165](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:124) [src/commands/meta.ts:199-233](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:199)

- Credential files are forced to mode 0600. [src/config.ts:279-284](/Users/z/code/linear-sdk-cli/src/config.ts:279)

- `gh` arguments are passed through `execFileSync` as an argv array, so issue title/body/base/head cannot become shell syntax. [src/git.ts:70-81](/Users/z/code/linear-sdk-cli/src/git.ts:70) [src/commands/issue.ts:670-681](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:670)

- User-supplied query/body files are read directly rather than evaluated or interpolated through a shell. [src/lib/body.ts:32-38](/Users/z/code/linear-sdk-cli/src/lib/body.ts:32) [src/commands/api.ts:72-78](/Users/z/code/linear-sdk-cli/src/commands/api.ts:72)

Material remaining concerns:

- Malformed TOML diagnostics can leak keys/control bytes, as confirmed above. [src/config.ts:89-97](/Users/z/code/linear-sdk-cli/src/config.ts:89)

- Credentials are non-atomic and unlocked, despite their 0600 mode. [src/config.ts:279-342](/Users/z/code/linear-sdk-cli/src/config.ts:279)

- API keys and webhook signing secrets can be supplied on argv, exposing them through shell history and process inspection. Prefer prompt/stdin/file routes or at least warn users. [src/lib/options.ts:59-64](/Users/z/code/linear-sdk-cli/src/lib/options.ts:59) [src/commands/webhook.ts:68-110](/Users/z/code/linear-sdk-cli/src/commands/webhook.ts:68)

- `issue pr` passes the complete Linear issue description via `gh --body` argv. It is injection-safe, but potentially confidential content remains process-visible; a protected `--body-file` is safer. [src/commands/issue.ts:442-456](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:442) [src/git.ts:75-81](/Users/z/code/linear-sdk-cli/src/git.ts:75)

- Browser/editor process errors are inconsistently handled: browser errors are swallowed, while editor invocation is shell-safe but fails for common editor-with-flags values. [src/commands/issue.ts:685-688](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:685) [src/lib/body.ts:49-58](/Users/z/code/linear-sdk-cli/src/lib/body.ts:49)

## Top 10 fixes, ranked

1. **Make raw API pagination query-only and implement real operation selection** — critical impact, low-to-medium effort. [src/commands/api.ts:47-60](/Users/z/code/linear-sdk-cli/src/commands/api.ts:47) [src/commands/api.ts:123-149](/Users/z/code/linear-sdk-cli/src/commands/api.ts:123)

2. **Introduce a typed mutation-success unwrapper and apply it everywhere** — high impact, medium effort. [src/services/issue.ts:428-442](/Users/z/code/linear-sdk-cli/src/services/issue.ts:428) [src/services/notification.ts:92-125](/Users/z/code/linear-sdk-cli/src/services/notification.ts:92)

3. **Bind stored credentials to the validated organization and preserve auth/network error classes** — high impact, low effort. [src/commands/meta.ts:65-76](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:65)

4. **Replace every permissive integer parse with strict, field-specific validation** — high impact, low effort. [src/lib/options.ts:33-48](/Users/z/code/linear-sdk-cli/src/lib/options.ts:33) [src/lib/resolve.ts:227-244](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:227)

5. **Correct project status and issue state/label filters** — high impact, low-to-medium effort. [src/services/project.ts:49-64](/Users/z/code/linear-sdk-cli/src/services/project.ts:49) [src/services/issue.ts:129-144](/Users/z/code/linear-sdk-cli/src/services/issue.ts:129)

6. **Make pagination cardinality-correct throughout**: exhaust name resolvers, paginate embedded relations, request `limit+1` for truncation, and retry `fetchNext` — high impact, medium effort. [src/lib/pagination.ts:16-25](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:16) [src/lib/resolve.ts:27-260](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:27)

7. **Make credential persistence atomic, locked, and diagnostic-safe** — high security/robustness impact, medium effort. [src/config.ts:89-97](/Users/z/code/linear-sdk-cli/src/config.ts:89) [src/config.ts:279-342](/Users/z/code/linear-sdk-cli/src/config.ts:279)

8. **Sort globally before applying limits and consolidate state/cycle implementations** — medium impact, medium effort. [src/services/state.ts:23-34](/Users/z/code/linear-sdk-cli/src/services/state.ts:23) [src/services/cycle.ts:24-38](/Users/z/code/linear-sdk-cli/src/services/cycle.ts:24)

9. **Use SDK input/filter types and generated types for bespoke GraphQL documents** — large preventive value, medium-to-high effort. [src/services/issue.ts:114-176](/Users/z/code/linear-sdk-cli/src/services/issue.ts:114) [linear-cli-reference/codegen.ts:3-33](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/codegen.ts:3)

10. **Add SDK-backed offline command tests through a local GraphQL endpoint** — broad regression-prevention value, medium effort. Start with API operation/pagination, false mutation payloads, page-two resolvers, filter behavior, and concurrent config writers. [test/unit/api.test.ts:1-18](/Users/z/code/linear-sdk-cli/test/unit/api.test.ts:1) [linear-cli-reference/test/utils/mock_linear_server.ts:94-187](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/test/utils/mock_linear_server.ts:94)
tokens used
834,966
## Verdict

- The core commands → services → SDK structure is sound for most CRUD paths, but `api`, `schema`, and `meta` bypass it, and one bypass directly caused a real v89 incompatibility. [src/commands/api.ts:59-60](/Users/z/code/linear-sdk-cli/src/commands/api.ts:59) [src/commands/meta.ts:27-76](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:27)

- The most dangerous defect is `linear api --paginate`: it can repeat an arbitrary GraphQL mutation once per page, creating duplicate entities. [src/commands/api.ts:123-149](/Users/z/code/linear-sdk-cli/src/commands/api.ts:123)

- Mutation success handling is not trustworthy. Several commands can exit zero and report success after a type-valid `{success:false}` payload. [src/services/issue.ts:428-430](/Users/z/code/linear-sdk-cli/src/services/issue.ts:428) [src/services/notification.ts:92-125](/Users/z/code/linear-sdk-cli/src/services/notification.ts:92)

- Pagination is broadly implemented, but boundary correctness is uneven: fixed resolver caps cause false `not_found`, embedded connections are silently partial, and milestone truncation can explicitly lie. [src/lib/resolve.ts:41-46](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:41) [src/services/milestone.ts:78-104](/Users/z/code/linear-sdk-cli/src/services/milestone.ts:78)

- Filter builders contain real semantic errors: project status names target the deprecated field, label filtering is case-sensitive, and state aliases can override exact custom names. [src/services/project.ts:49-64](/Users/z/code/linear-sdk-cli/src/services/project.ts:49) [src/services/issue.ts:129-144](/Users/z/code/linear-sdk-cli/src/services/issue.ts:129)

- Credential selection correctly excludes valid project-file keys, but malformed TOML can disclose a key, login can store a valid key under the wrong workspace, and writes are non-atomic. [src/config.ts:101-113](/Users/z/code/linear-sdk-cli/src/config.ts:101) [src/commands/meta.ts:65-76](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:65) [src/config.ts:279-301](/Users/z/code/linear-sdk-cli/src/config.ts:279)

- TypeScript is configured strictly, but pervasive `any` casts make that protection largely porous at the SDK boundary. The dead `--operation` flag is direct evidence, not a theoretical complaint. [tsconfig.json:2-17](/Users/z/code/linear-sdk-cli/tsconfig.json:2) [eslint.config.js:8-16](/Users/z/code/linear-sdk-cli/eslint.config.js:8)

- The test suite is broad but too happy-path and mock-centric. Several tests actually lock in faulty filter shapes or return payloads the real SDK does not produce. [test/unit/project.test.ts:23-33](/Users/z/code/linear-sdk-cli/test/unit/project.test.ts:23) [test/unit/issue-filter.test.ts:40-48](/Users/z/code/linear-sdk-cli/test/unit/issue-filter.test.ts:40)

- Keep OURS’ service layer, but steal THEIRS’ generated GraphQL document types and local transport-level test harness. [linear-cli-reference/codegen.ts:3-33](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/codegen.ts:3) [linear-cli-reference/test/utils/mock_linear_server.ts:94-164](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/test/utils/mock_linear_server.ts:94)

## Confirmed bugs

### 1. `api --paginate` can repeat mutations

- **Severity:** Critical

- **What breaks:** Pagination reruns the complete GraphQL document for every cursor without checking the selected operation’s kind.

- **Failure scenario:** Run a create mutation that returns a nested connection with `first: 1` and `hasNextPage: true`. Page two reruns the create mutation, producing a second entity; further pages can produce further duplicates.

- **Location:** Arbitrary queries and mutations accept `--paginate` at [src/commands/api.ts:22-30](/Users/z/code/linear-sdk-cli/src/commands/api.ts:22); dispatch performs no operation-kind validation at [src/commands/api.ts:47-55](/Users/z/code/linear-sdk-cli/src/commands/api.ts:47); the whole document is rerun at [src/commands/api.ts:123-149](/Users/z/code/linear-sdk-cli/src/commands/api.ts:123).

- **Fix:** Parse the document using `graphql`, select the named/default operation, and reject pagination for mutation and subscription operations.

### 2. A key can be stored under the wrong workspace and later mutate the wrong organization

- **Severity:** High

- **What breaks:** `auth login` fetches the key’s real `organization.urlKey`, but an arbitrary `--workspace` replaces it without validation.

- **Failure scenario:** `linear auth login --workspace org-b --key <org-a-key>` overwrites the `org-b` entry with an org-A key. Later, `linear --workspace org-b issue update ...` silently acts in org A.

- **Location:** The organization is validated at [src/commands/meta.ts:65-74](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:65), but the unchecked flag wins at [src/commands/meta.ts:75-76](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:75), and `writeCredential` overwrites the selected entry at [src/config.ts:295-301](/Users/z/code/linear-sdk-cli/src/config.ts:295).

- **Fix:** Require `--workspace === org.urlKey`. If aliases are intentional, rename the concept to “profile” and persist the validated organization ID and slug alongside it.

### 3. Failed mutations can be reported as successful

- **Severity:** High

- **What breaks:** Multiple services either ignore `payload.success` or replace a missing updated entity with the pre-mutation entity.

- **Failure scenario:** A valid issue payload `{success:false, issue:null}` causes `updateIssue` to return the old issue, after which the command prints `Updated TES-1` and exits zero. Similarly, notification read/snooze commands discard `success:false`, while `read-all` ignores every update result and unconditionally returns `{success:true}`.

- **Location:** Issue fallback at [src/services/issue.ts:428-430](/Users/z/code/linear-sdk-cli/src/services/issue.ts:428), success output at [src/commands/issue.ts:258-277](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:258), notification handling at [src/services/notification.ts:92-125](/Users/z/code/linear-sdk-cli/src/services/notification.ts:92) and [src/commands/notification.ts:38-99](/Users/z/code/linear-sdk-cli/src/commands/notification.ts:38). SDK v89 explicitly types nullable `issue` separately from `success` at [node_modules/@linear/sdk/dist/index-DHA7xCPn.d.mts:10598-10606](/Users/z/code/linear-sdk-cli/node_modules/@linear/sdk/dist/index-DHA7xCPn.d.mts:10598).

- **Fix:** Add a typed `assertMutationSuccess`/`unwrapMutation` helper. Require `success === true`, require the entity where appropriate, and never substitute stale pre-mutation data.

THEIRS handles this better by checking both success and entity presence. [linear-cli-reference/src/commands/issue/issue-update.ts:303-315](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/src/commands/issue/issue-update.ts:303)

### 4. Malformed config can disclose API keys and emit terminal control bytes

- **Severity:** High

- **What breaks:** The raw TOML parser message is embedded verbatim in a CLI error. `smol-toml` includes the offending source line.

- **Failure scenario:** A malformed user line such as `api_key = "lin_api_SECRET` prints the full key to stderr. A repository-controlled malformed `.linear.toml` can similarly include ANSI or OSC bytes in human-mode error output.

- **Location:** Raw parser message propagation at [src/config.ts:89-97](/Users/z/code/linear-sdk-cli/src/config.ts:89), unconditional project parsing at [src/config.ts:168-177](/Users/z/code/linear-sdk-cli/src/config.ts:168), and unsanitized human output at [src/output/format.ts:82-94](/Users/z/code/linear-sdk-cli/src/output/format.ts:82).

- **Fix:** Emit only sanitized path, reason, line, and column. Strip control characters and never include source excerpts from credential-bearing files.

### 5. Filter builders return the wrong project and issue sets

- **Severity:** Medium

- **What breaks:**
  - Project `--state <name>` filters deprecated `Project.state` instead of `status.name`.
  - Issue labels use case-sensitive `name.in`.
  - A canonical type token such as `Started` wins before an exact custom workflow-state name is considered.

- **Failure scenarios:**
  - A custom project status named `In QA` produces no results because `state` contains the coarse legacy status group.
  - A stored label `bug` is missed by `--label Bug`.
  - A custom state literally named `Started` with type `unstarted` makes `--state Started` return all `started`-type issues instead.

- **Location:** Project filter at [src/services/project.ts:49-64](/Users/z/code/linear-sdk-cli/src/services/project.ts:49); the current schema marks `state` deprecated and exposes `status` at [linear-cli-reference/graphql/schema.graphql:26366-26370](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/graphql/schema.graphql:26366); issue state/label filters at [src/services/issue.ts:129-144](/Users/z/code/linear-sdk-cli/src/services/issue.ts:129).

- **Fix:** Filter project statuses through `status.name.eqIgnoreCase` or resolve a status ID. Make issue label comparisons case-insensitive. Resolve a state name before falling back to type aliases, matching `resolveStateId`’s name-first behavior.

THEIRS correctly uses `status.name` and case-insensitive per-label filters. [linear-cli-reference/src/commands/project/project-list.ts:114-123](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/src/commands/project/project-list.ts:114) [linear-cli-reference/src/utils/linear.ts:578-586](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/src/utils/linear.ts:578)

### 6. `api --operation` is a no-op

- **Severity:** Medium

- **What breaks:** The option is accepted but never reaches the HTTP request body.

- **Failure scenario:** A two-operation document invoked with `--operation ReadIssues` is still sent without `operationName`, so GraphQL rejects it as ambiguous.

- **Location:** The flag is registered at [src/commands/api.ts:22-30](/Users/z/code/linear-sdk-cli/src/commands/api.ts:22), then passed as a fourth `rawRequest` argument at [src/commands/api.ts:59-60](/Users/z/code/linear-sdk-cli/src/commands/api.ts:59) and [src/commands/api.ts:135-138](/Users/z/code/linear-sdk-cli/src/commands/api.ts:135). SDK v89 accepts only three arguments and serializes only `query` and `variables`. [node_modules/@linear/sdk/dist/index.d.mts:117-125](/Users/z/code/linear-sdk-cli/node_modules/@linear/sdk/dist/index.d.mts:117) [node_modules/@linear/sdk/dist/index.mjs:1348-1363](/Users/z/code/linear-sdk-cli/node_modules/@linear/sdk/dist/index.mjs:1348)

- **Fix:** Use a transport capable of sending `operationName`, or AST-select the requested operation plus its referenced fragments into a single-operation document.

### 7. Malformed numeric input silently becomes a different mutation or filter

- **Severity:** Medium

- **What breaks:** `Number.parseInt` accepts numeric prefixes.

- **Failure scenario:** `--priority 1.9` mutates priority to `1`; `--estimate 2junk` stores estimate `2`; `--cycle 12garbage` resolves cycle 12; issue list priority `"2oops"` becomes `2`.

- **Location:** Shared parser at [src/lib/options.ts:33-36](/Users/z/code/linear-sdk-cli/src/lib/options.ts:33), cycle resolver at [src/lib/resolve.ts:227-244](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:227), issue filter at [src/services/issue.ts:139-144](/Users/z/code/linear-sdk-cli/src/services/issue.ts:139), and mutation wiring at [src/commands/issue.ts:167-172](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:167).

- **Fix:** Require a complete integer token, then apply field-specific constraints: priority 0–4 and an explicit estimate policy.

### 8. Fixed resolver page caps cause false `not_found` or incorrect ambiguity

- **Severity:** Medium

- **What breaks:** Several name resolvers inspect only the first connection page.

- **Failure scenarios:**
  - A matching team at position 251 is reported missing.
  - A milestone at position 101 in a project is reported missing.
  - Fifty same-name labels from other teams can fill the first page, hiding the matching team-scoped label on page two.

- **Location:** Team cap at [src/lib/resolve.ts:41-46](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:41), issue-label cap and post-query team scoping at [src/lib/resolve.ts:105-119](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:105), milestone cap at [src/lib/resolve.ts:247-260](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:247).

- **Fix:** Prefer server-side ID/name/team filters. Where client-side scoping remains necessary, exhaust the connection before deciding `not_found` or ambiguity.

### 9. Detail and row outputs silently truncate embedded connections

- **Severity:** Medium

- **What breaks:** Nested relations are emitted as apparently complete arrays without following their cursors or exposing truncation.

- **Failure scenarios:**
  - Issue list/search returns only the first 20 labels.
  - Issue detail omits subscribers beyond the SDK’s default page.
  - Project detail omits members or labels beyond the first page.
  - A roadmap with 101 projects reports only 100.

- **Location:** Issue row queries and mapping at [src/services/issue.ts:100-110](/Users/z/code/linear-sdk-cli/src/services/issue.ts:100), [src/services/issue.ts:197-207](/Users/z/code/linear-sdk-cli/src/services/issue.ts:197), and [src/services/issue.ts:245-260](/Users/z/code/linear-sdk-cli/src/services/issue.ts:245); issue detail at [src/services/issue.ts:287-322](/Users/z/code/linear-sdk-cli/src/services/issue.ts:287); project detail at [src/services/project.ts:118-149](/Users/z/code/linear-sdk-cli/src/services/project.ts:118); roadmap cap at [src/services/roadmap.ts:58-81](/Users/z/code/linear-sdk-cli/src/services/roadmap.ts:58).

- **Fix:** Paginate relations with `collect`. For deliberately capped nested data, return an explicit `truncated` field rather than presenting the array as complete.

### 10. Milestone detail can say `issuesTruncated:false` after truncating issues

- **Severity:** Medium

- **What breaks:** `collect` fetches a full next page and slices to `limit`, while SDK `fetchNext()` mutates the original connection’s `pageInfo`. The later truncation check therefore sees the final `hasNextPage:false`.

- **Failure scenario:** A milestone has 180 issues and `--limit 150`. The CLI returns 150 issues but says `issuesTruncated:false`.

- **Location:** Collection and slicing at [src/lib/pagination.ts:16-25](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:16); truncation is calculated after collection at [src/services/milestone.ts:78-104](/Users/z/code/linear-sdk-cli/src/services/milestone.ts:78); SDK mutation behavior is visible at [node_modules/@linear/sdk/dist/index.mjs:70134-70163](/Users/z/code/linear-sdk-cli/node_modules/@linear/sdk/dist/index.mjs:70134).

- **Fix:** Request `limit + 1`, or capture “more existed” before fetching/slicing. Return the first `limit` and set truncation from the extra item.

### 11. Sorting after applying `limit` selects the wrong subset

- **Severity:** Medium

- **What breaks:** State and cycle services fetch only `limit` items, then sort that partial set by a different field than the server pagination order.

- **Failure scenario:** State positions arrive `[3,1,2]`; `--limit 2` returns `[1,3]`, not global positions `[1,2]`. Cycles `[#1,#10,#9]` with limit 2 return `[#10,#1]`, omitting #9.

- **Location:** State path at [src/services/state.ts:23-34](/Users/z/code/linear-sdk-cli/src/services/state.ts:23), duplicate team-state path at [src/services/team.ts:118-135](/Users/z/code/linear-sdk-cli/src/services/team.ts:118), cycle path at [src/services/cycle.ts:24-38](/Users/z/code/linear-sdk-cli/src/services/cycle.ts:24). The schema says these connections paginate by `createdAt`/`updatedAt`, not position or cycle number. [linear-cli-reference/graphql/schema.graphql:35874-35901](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/graphql/schema.graphql:35874)

- **Fix:** Use compatible server-side ordering if available; otherwise exhaust, sort globally, then slice.

### 12. Concurrent credential writes can silently lose work

- **Severity:** Medium

- **What breaks:** Credential operations perform unlocked read-modify-write and overwrite the live file directly.

- **Failure scenario:** Two concurrent logins read the same config, each adds a different workspace, and the later write erases the first addition. A crash during the direct write can truncate the credential store.

- **Location:** Direct persistence at [src/config.ts:279-284](/Users/z/code/linear-sdk-cli/src/config.ts:279); read-modify-write callers at [src/config.ts:295-318](/Users/z/code/linear-sdk-cli/src/config.ts:295) and [src/config.ts:326-342](/Users/z/code/linear-sdk-cli/src/config.ts:326).

- **Fix:** Lock credential mutations, write a mode-0600 temporary sibling, fsync, and atomically rename.

### 13. Catch-all error rewriting produces false diagnoses

- **Severity:** Medium

- **What breaks:** Unrelated operational failures are rewritten as authentication or not-found errors.

- **Failure scenarios:**
  - DNS, timeout, 429, or Linear 5xx during login becomes “That API key was rejected”.
  - A rate-limit or authorization error resolving a document slug becomes “No document matching”.
  - A failed webhook lookup during deletion becomes “No webhook matching”.

- **Location:** Login catch-all at [src/commands/meta.ts:65-74](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:65), document resolver at [src/services/document.ts:194-201](/Users/z/code/linear-sdk-cli/src/services/document.ts:194), webhook deletion at [src/services/webhook.ts:159-164](/Users/z/code/linear-sdk-cli/src/services/webhook.ts:159).

- **Fix:** Normalize the original error and rewrite only an actual `auth` or `not_found` classification. Login validation should also use `withRetry`.

### 14. Typed SDK pagination retries page one but not subsequent pages

- **Severity:** Medium

- **What breaks:** Callers wrap the initial connection request in `withRetry`, but `collect` invokes `fetchNext()` directly.

- **Failure scenario:** Page two receives a transient rate limit that would succeed on retry. Raw-query pagination retries it; typed pagination fails the entire command immediately.

- **Location:** Unwrapped fetch at [src/lib/pagination.ts:16-25](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:16), versus retrying every raw page at [src/lib/pagination.ts:68-80](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:68).

- **Fix:** Wrap `conn.fetchNext()` in `withRetry`, and test a transient page-two failure.

### 15. `issue view --web` reports success when no browser opened

- **Severity:** Low

- **What breaks:** `openUrl` discards the child-process error and always resolves.

- **Failure scenario:** Missing `xdg-open`, a headless opener failure, or the current Windows `start` invocation fails, but JSON still contains `opened:true`.

- **Location:** Success emission at [src/commands/issue.ts:65-72](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:65); swallowed callback error at [src/commands/issue.ts:685-688](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:685).

- **Fix:** Reject on spawn/nonzero error and use a correct Windows launcher.

### 16. `schema --json --output` ignores the output path

- **Severity:** Low

- **What breaks:** `--output` promises file output, but JSON mode returns before file writing.

- **Failure scenario:** `linear schema --json --output schema.json` writes JSON to stdout and creates no file.

- **Location:** Option registration at [src/commands/discover.ts:55-60](/Users/z/code/linear-sdk-cli/src/commands/discover.ts:55), early JSON return at [src/commands/discover.ts:79-82](/Users/z/code/linear-sdk-cli/src/commands/discover.ts:79), SDL-only file branch at [src/commands/discover.ts:85-90](/Users/z/code/linear-sdk-cli/src/commands/discover.ts:85).

- **Fix:** Serialize the selected representation first, then consistently route it to the file or stdout.

### 17. Common `$EDITOR` values with arguments fail

- **Severity:** Low

- **What breaks:** The entire environment value is treated as one executable filename.

- **Failure scenario:** `EDITOR='code --wait'` attempts to launch an executable literally named `code --wait`.

- **Location:** [src/lib/body.ts:49-56](/Users/z/code/linear-sdk-cli/src/lib/body.ts:49).

- **Fix:** Parse a safely defined editor argv format without invoking a shell, or provide separate executable and argument settings.

### 18. Project detail collapses empty strings into `null`

- **Severity:** Low

- **What breaks:** Empty description/content and absent description/content become indistinguishable in JSON.

- **Failure scenario:** A deliberately cleared project body stored as `""` is emitted as `null`.

- **Location:** [src/services/project.ts:128-133](/Users/z/code/linear-sdk-cli/src/services/project.ts:128).

- **Fix:** Replace `|| null` with `?? null` and remove the unnecessary `content` cast.

## Unconfirmed suspicions

- `withRetry` treats non-idempotent creates exactly like reads. An ambiguous rate-limit/network failure delivered after server-side commit could replay a create, but I did not confirm Linear can produce that ordering. [src/client.ts:25-45](/Users/z/code/linear-sdk-cli/src/client.ts:25)

- Repeated issue labels currently mean “any label”, while THEIRS requires all supplied labels. The CLI does not state the intended conjunction clearly enough to call OURS definitively wrong. [src/services/issue.ts:139-141](/Users/z/code/linear-sdk-cli/src/services/issue.ts:139) [linear-cli-reference/src/utils/linear.ts:578-586](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/src/utils/linear.ts:578)

- `listProjects` sends `filter:{}` while issue search deliberately omits an empty filter. I did not verify whether Linear currently distinguishes `{}` from `null` for `projects`. [src/services/project.ts:67-79](/Users/z/code/linear-sdk-cli/src/services/project.ts:67) [src/services/issue.ts:229-238](/Users/z/code/linear-sdk-cli/src/services/issue.ts:229)

- UUID fast paths bypass scoping and existence checks. This is probably acceptable as an expert escape hatch, but it means state, cycle, milestone, and label IDs are not locally checked against the target team/project. [src/lib/resolve.ts:76-78](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:76) [src/lib/resolve.ts:233-255](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:233)

- `resolveLabelIds` does not distinguish assignable labels from label groups, while `label create --parent` reuses the same resolver without requiring a group parent. I expect backend validation, but did not prove the exact v89 failure behavior. [src/lib/resolve.ts:94-130](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:94) [src/services/label.ts:101-104](/Users/z/code/linear-sdk-cli/src/services/label.ts:101)

- `collectRawQuery` assumes that an existing connection always has nodes and that `hasNextPage` always carries a changing `endCursor`. A malformed response could throw a raw `TypeError` or repeat pages, but valid Relay responses should prevent this. [src/lib/pagination.ts:68-81](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:68)

- `Retry-After` supports an HTTP-date form, but the client only parses numeric seconds. I did not confirm which form Linear sends. [src/client.ts:48-54](/Users/z/code/linear-sdk-cli/src/client.ts:48)

## Architecture & layering

The advertised layering holds for most curated domain operations: commands gather options and delegate, while services own SDK traversal and mutations. Cycle and project are representative. [src/commands/cycle.ts:23-56](/Users/z/code/linear-sdk-cli/src/commands/cycle.ts:23) [src/commands/project.ts:27-61](/Users/z/code/linear-sdk-cli/src/commands/project.ts:27)

It does not hold absolutely:

- `meta.ts` imports and constructs `LinearClient`, reads `viewer`/`organization`, and implements auth validation directly. [src/commands/meta.ts:6-18](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:6) [src/commands/meta.ts:27-76](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:27)

- `api.ts` and `discover.ts` access `ctx.client.client.rawRequest` directly. Low-level access is appropriate to their purpose, but it should live behind a shared transport abstraction so operation selection, retries, and tests are consistent. [src/commands/api.ts:43-68](/Users/z/code/linear-sdk-cli/src/commands/api.ts:43) [src/commands/discover.ts:71-88](/Users/z/code/linear-sdk-cli/src/commands/discover.ts:71)

- `issue.ts` contains significant Git/GitHub/browser orchestration and rendering. This is not SDK leakage, but the command is no longer thin. [src/commands/issue.ts:361-469](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:361) [src/commands/issue.ts:594-625](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:594)

The raw-query/SDK split is defensible where tailored projections avoid N+1 access: issue rows inline state, assignee, project, and labels; notification rows need union-specific relations. [src/services/issue.ts:100-110](/Users/z/code/linear-sdk-cli/src/services/issue.ts:100) [src/services/notification.ts:27-41](/Users/z/code/linear-sdk-cli/src/services/notification.ts:27)

It becomes ad hoc where:

- `collectRawQuery` erases document, variables, connection, and node types. [src/lib/pagination.ts:34-75](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:34)

- Comment listing implements another hand-written pagination loop rather than using the shared helper. [src/services/comment.ts:27-68](/Users/z/code/linear-sdk-cli/src/services/comment.ts:27)

- Initiative list uses raw GraphQL for mostly scalar output while comparable simple services use typed SDK connections. [src/services/initiative.ts:49-79](/Users/z/code/linear-sdk-cli/src/services/initiative.ts:49) [src/services/roadmap.ts:36-41](/Users/z/code/linear-sdk-cli/src/services/roadmap.ts:36)

THEIRS’ organization is worse for separation—commands perform validation, GraphQL, transformation, and output together—but better for query type safety. Its generated documents use strict scalar mappings and make operation result/input types compiler-visible. [linear-cli-reference/codegen.ts:3-33](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/codegen.ts:3) [linear-cli-reference/src/commands/project/project-list.ts:16-58](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/src/commands/project/project-list.ts:16)

The right hybrid is OURS’ service boundary plus generated types for every bespoke raw document.

## Duplication & consistency

- Comments are implemented twice. `issue comments` returns `{user}` without URL; top-level `comment list` returns `{author,url}`. Equivalent operations therefore have incompatible JSON. [src/services/issue.ts:453-473](/Users/z/code/linear-sdk-cli/src/services/issue.ts:453) [src/services/comment.ts:19-25](/Users/z/code/linear-sdk-cli/src/services/comment.ts:19) [src/services/comment.ts:41-68](/Users/z/code/linear-sdk-cli/src/services/comment.ts:41)

- Workflow-state listing is duplicated almost verbatim, including the selection-before-sort bug. [src/services/state.ts:23-34](/Users/z/code/linear-sdk-cli/src/services/state.ts:23) [src/services/team.ts:118-135](/Users/z/code/linear-sdk-cli/src/services/team.ts:118)

- Cycle behavior diverges: standalone cycles sort descending, while `team cycles` preserves API order. [src/services/cycle.ts:24-38](/Users/z/code/linear-sdk-cli/src/services/cycle.ts:24) [src/services/team.ts:164-179](/Users/z/code/linear-sdk-cli/src/services/team.ts:164)

- Mutation unwrapping ranges from correctly checking `success`, to merely requiring an entity, to returning stale data. [src/services/comment.ts:118-121](/Users/z/code/linear-sdk-cli/src/services/comment.ts:118) [src/services/project.ts:231-236](/Users/z/code/linear-sdk-cli/src/services/project.ts:231) [src/services/issue.ts:428-430](/Users/z/code/linear-sdk-cli/src/services/issue.ts:428)

- Priority validation is duplicated in project and initiative, but absent from issue mutations. [src/services/project.ts:305-313](/Users/z/code/linear-sdk-cli/src/services/project.ts:305) [src/services/initiative.ts:25-31](/Users/z/code/linear-sdk-cli/src/services/initiative.ts:25) [src/services/issue.ts:349-352](/Users/z/code/linear-sdk-cli/src/services/issue.ts:349)

- Date normalization is duplicated between attachment and cycle services. [src/services/attachment.ts:91-95](/Users/z/code/linear-sdk-cli/src/services/attachment.ts:91) [src/services/cycle.ts:180-184](/Users/z/code/linear-sdk-cli/src/services/cycle.ts:180)

- `promptSelect` and its import have no caller; `api.paginate` assigns `firstData` but never uses it. [src/lib/prompt.ts:7-45](/Users/z/code/linear-sdk-cli/src/lib/prompt.ts:7) [src/commands/api.ts:129-140](/Users/z/code/linear-sdk-cli/src/commands/api.ts:129)

A good counterexample is `src/lib/status-update.ts`: it successfully shares flags, columns, and row normalization across project and initiative updates, although its payload typing remains weak. [src/lib/status-update.ts:28-64](/Users/z/code/linear-sdk-cli/src/lib/status-update.ts:28)

## Types

The nominal compiler posture is strong: `strict`, `noUncheckedIndexedAccess`, and `noImplicitOverride` are enabled. Explicit `any`, however, is deliberately allowed by lint. [tsconfig.json:2-17](/Users/z/code/linear-sdk-cli/tsconfig.json:2) [eslint.config.js:8-16](/Users/z/code/linear-sdk-cli/eslint.config.js:8)

The weakest boundaries are:

- Mutation inputs are built as `Record<string, any>` despite v89 exporting exact `IssueCreateInput`, `IssueUpdateInput`, `ProjectCreateInput`, and related types. [src/services/issue.ts:342-366](/Users/z/code/linear-sdk-cli/src/services/issue.ts:342) [src/services/project.ts:169-189](/Users/z/code/linear-sdk-cli/src/services/project.ts:169)

- Filters are untyped objects, so comparator and field selection cannot be checked. [src/services/issue.ts:114-160](/Users/z/code/linear-sdk-cli/src/services/issue.ts:114) [src/services/project.ts:49-64](/Users/z/code/linear-sdk-cli/src/services/project.ts:49)

- Initiative/project-label resolvers cast the client to `any` even though v89 types both methods. [src/lib/resolve.ts:143-187](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:143) [node_modules/@linear/sdk/dist/index.d.mts:26838](/Users/z/code/linear-sdk-cli/node_modules/@linear/sdk/dist/index.d.mts:26838)

- Raw transforms accept arbitrary nodes, so a renamed or omitted GraphQL field compiles and becomes `undefined` output. [src/lib/pagination.ts:56-75](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:56)

- `normalizeUpdatePayload(payload:any, payloadKey:string)` loses the relationship between the selected field and payload type. [src/lib/status-update.ts:36-55](/Users/z/code/linear-sdk-cli/src/lib/status-update.ts:36)

- Unnecessary model casts remain for project content and milestone status. [src/services/project.ts:128-133](/Users/z/code/linear-sdk-cli/src/services/project.ts:128) [src/services/milestone.ts:91-100](/Users/z/code/linear-sdk-cli/src/services/milestone.ts:91)

The `--operation` defect is the clearest proof of harm: without `as any`, TypeScript would have rejected the unsupported fourth `rawRequest` argument. [src/commands/api.ts:59-60](/Users/z/code/linear-sdk-cli/src/commands/api.ts:59)

## Tests

Verification during this audit:

- `bun run typecheck` and `bun run lint` passed.

- Ninety-two targeted unit/contract tests across pagination, options, issue/project filters, state, cycle, milestone, notifications, API, and JSON output passed.

- I did not run the live suite because it is credential-gated and performs real workspace mutations and cleanup. [test/integration/_helpers.ts:18-22](/Users/z/code/linear-sdk-cli/test/integration/_helpers.ts:18) [test/integration/issue.test.ts:7-28](/Users/z/code/linear-sdk-cli/test/integration/issue.test.ts:7)

The principal gaps are not test count but fidelity and adversarial coverage:

- API tests exercise only `findConnection`; neither operation selection nor paginated execution is invoked. Both `api` bugs should have been caught here. [test/unit/api.test.ts:1-18](/Users/z/code/linear-sdk-cli/test/unit/api.test.ts:1)

- `parseIntOption` tests `42` and `abc`, but omit decimals and trailing junk—even though the strict limit parser tests those exact cases. [test/unit/options.test.ts:39-63](/Users/z/code/linear-sdk-cli/test/unit/options.test.ts:39)

- Project tests explicitly lock in the deprecated `state.eq` filter. Issue tests similarly lock in case-sensitive `name.in` instead of testing behavior against realistic data. [test/unit/project.test.ts:23-33](/Users/z/code/linear-sdk-cli/test/unit/project.test.ts:23) [test/unit/issue-filter.test.ts:40-48](/Users/z/code/linear-sdk-cli/test/unit/issue-filter.test.ts:40)

- Resolver tests cover only UUID detection and basic team/user/issue paths. State, label, project, cycle, milestone, initiative-label, project-label, ambiguity, scoping, and page-two behavior are absent. [test/unit/resolve.test.ts:1-92](/Users/z/code/linear-sdk-cli/test/unit/resolve.test.ts:1)

- State/team tests provide one complete page with a generous limit, so they cannot reveal selection-before-sort. [test/unit/state.test.ts:22-38](/Users/z/code/linear-sdk-cli/test/unit/state.test.ts:22) [test/unit/team.test.ts:75-89](/Users/z/code/linear-sdk-cli/test/unit/team.test.ts:75)

- Milestone tests return a new connection from `fetchNext`; the real SDK mutates the same connection. That mock difference hides the false truncation flag. [test/unit/milestone.test.ts:103-151](/Users/z/code/linear-sdk-cli/test/unit/milestone.test.ts:103)

- Notification tests return only `success:true`. No false-payload path is tested. [test/unit/notification.test.ts:97-156](/Users/z/code/linear-sdk-cli/test/unit/notification.test.ts:97)

- The issue-update mock omits the SDK-required `success` field, exactly masking the stale-success defect. [test/unit/issue-filter.test.ts:170-190](/Users/z/code/linear-sdk-cli/test/unit/issue-filter.test.ts:170)

- Some mocks produce SDK-impossible shapes: organization users include an inactive user without requesting `includeDisabled`, and cycle formatting passes `undefined as any` to a parameter typed `number`. [test/unit/organization.test.ts:48-62](/Users/z/code/linear-sdk-cli/test/unit/organization.test.ts:48) [test/unit/cycle.test.ts:44-53](/Users/z/code/linear-sdk-cli/test/unit/cycle.test.ts:44)

- The sole contract test calls `Output` directly. It proves renderer envelopes, not command parsing, SDK input construction, exit codes, or accidental output. [test/contract/json-envelope.test.ts:29-73](/Users/z/code/linear-sdk-cli/test/contract/json-envelope.test.ts:29)

THEIRS’ local GraphQL server is the best test strategy to copy: it sees the actual serialized document and variables and rejects unconfigured requests. [linear-cli-reference/test/utils/mock_linear_server.ts:94-164](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/test/utils/mock_linear_server.ts:94)

## Security & robustness

Positive findings:

- A valid project `.linear.toml` cannot select or supply the API key; selection is flag → environment → user credential workspace. [src/config.ts:179-231](/Users/z/code/linear-sdk-cli/src/config.ts:179) [test/unit/config.test.ts:48-72](/Users/z/code/linear-sdk-cli/test/unit/config.test.ts:48)

- Normal auth/config output redacts keys, while `auth token` is explicitly documented in code as the intentional secret-output path. [src/commands/meta.ts:124-165](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:124) [src/commands/meta.ts:199-233](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:199)

- Credential files are forced to mode 0600. [src/config.ts:279-284](/Users/z/code/linear-sdk-cli/src/config.ts:279)

- `gh` arguments are passed through `execFileSync` as an argv array, so issue title/body/base/head cannot become shell syntax. [src/git.ts:70-81](/Users/z/code/linear-sdk-cli/src/git.ts:70) [src/commands/issue.ts:670-681](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:670)

- User-supplied query/body files are read directly rather than evaluated or interpolated through a shell. [src/lib/body.ts:32-38](/Users/z/code/linear-sdk-cli/src/lib/body.ts:32) [src/commands/api.ts:72-78](/Users/z/code/linear-sdk-cli/src/commands/api.ts:72)

Material remaining concerns:

- Malformed TOML diagnostics can leak keys/control bytes, as confirmed above. [src/config.ts:89-97](/Users/z/code/linear-sdk-cli/src/config.ts:89)

- Credentials are non-atomic and unlocked, despite their 0600 mode. [src/config.ts:279-342](/Users/z/code/linear-sdk-cli/src/config.ts:279)

- API keys and webhook signing secrets can be supplied on argv, exposing them through shell history and process inspection. Prefer prompt/stdin/file routes or at least warn users. [src/lib/options.ts:59-64](/Users/z/code/linear-sdk-cli/src/lib/options.ts:59) [src/commands/webhook.ts:68-110](/Users/z/code/linear-sdk-cli/src/commands/webhook.ts:68)

- `issue pr` passes the complete Linear issue description via `gh --body` argv. It is injection-safe, but potentially confidential content remains process-visible; a protected `--body-file` is safer. [src/commands/issue.ts:442-456](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:442) [src/git.ts:75-81](/Users/z/code/linear-sdk-cli/src/git.ts:75)

- Browser/editor process errors are inconsistently handled: browser errors are swallowed, while editor invocation is shell-safe but fails for common editor-with-flags values. [src/commands/issue.ts:685-688](/Users/z/code/linear-sdk-cli/src/commands/issue.ts:685) [src/lib/body.ts:49-58](/Users/z/code/linear-sdk-cli/src/lib/body.ts:49)

## Top 10 fixes, ranked

1. **Make raw API pagination query-only and implement real operation selection** — critical impact, low-to-medium effort. [src/commands/api.ts:47-60](/Users/z/code/linear-sdk-cli/src/commands/api.ts:47) [src/commands/api.ts:123-149](/Users/z/code/linear-sdk-cli/src/commands/api.ts:123)

2. **Introduce a typed mutation-success unwrapper and apply it everywhere** — high impact, medium effort. [src/services/issue.ts:428-442](/Users/z/code/linear-sdk-cli/src/services/issue.ts:428) [src/services/notification.ts:92-125](/Users/z/code/linear-sdk-cli/src/services/notification.ts:92)

3. **Bind stored credentials to the validated organization and preserve auth/network error classes** — high impact, low effort. [src/commands/meta.ts:65-76](/Users/z/code/linear-sdk-cli/src/commands/meta.ts:65)

4. **Replace every permissive integer parse with strict, field-specific validation** — high impact, low effort. [src/lib/options.ts:33-48](/Users/z/code/linear-sdk-cli/src/lib/options.ts:33) [src/lib/resolve.ts:227-244](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:227)

5. **Correct project status and issue state/label filters** — high impact, low-to-medium effort. [src/services/project.ts:49-64](/Users/z/code/linear-sdk-cli/src/services/project.ts:49) [src/services/issue.ts:129-144](/Users/z/code/linear-sdk-cli/src/services/issue.ts:129)

6. **Make pagination cardinality-correct throughout**: exhaust name resolvers, paginate embedded relations, request `limit+1` for truncation, and retry `fetchNext` — high impact, medium effort. [src/lib/pagination.ts:16-25](/Users/z/code/linear-sdk-cli/src/lib/pagination.ts:16) [src/lib/resolve.ts:27-260](/Users/z/code/linear-sdk-cli/src/lib/resolve.ts:27)

7. **Make credential persistence atomic, locked, and diagnostic-safe** — high security/robustness impact, medium effort. [src/config.ts:89-97](/Users/z/code/linear-sdk-cli/src/config.ts:89) [src/config.ts:279-342](/Users/z/code/linear-sdk-cli/src/config.ts:279)

8. **Sort globally before applying limits and consolidate state/cycle implementations** — medium impact, medium effort. [src/services/state.ts:23-34](/Users/z/code/linear-sdk-cli/src/services/state.ts:23) [src/services/cycle.ts:24-38](/Users/z/code/linear-sdk-cli/src/services/cycle.ts:24)

9. **Use SDK input/filter types and generated types for bespoke GraphQL documents** — large preventive value, medium-to-high effort. [src/services/issue.ts:114-176](/Users/z/code/linear-sdk-cli/src/services/issue.ts:114) [linear-cli-reference/codegen.ts:3-33](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/codegen.ts:3)

10. **Add SDK-backed offline command tests through a local GraphQL endpoint** — broad regression-prevention value, medium effort. Start with API operation/pagination, false mutation payloads, page-two resolvers, filter behavior, and concurrent config writers. [test/unit/api.test.ts:1-18](/Users/z/code/linear-sdk-cli/test/unit/api.test.ts:1) [linear-cli-reference/test/utils/mock_linear_server.ts:94-187](/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference/test/utils/mock_linear_server.ts:94)
