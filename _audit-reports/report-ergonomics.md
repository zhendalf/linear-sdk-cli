## Verdict

- Ours has the stronger foundation for agents: centralized bare-array/object JSON, structured stderr errors, distinct exit codes, and live command/schema discovery. Theirs has no comparable uniform contract. `src/output/format.ts:1-10`; `src/lib/errors.ts:5-46`; `src/commands/discover.ts:18-93`; `linear-cli-reference/AGENTS.md:26-27`
- That contract is not yet dependable: `--no-input` is miswired and still prompts in a TTY; a declined destructive prompt exits 0 with no JSON; `--json --debug` appends plaintext to the error envelope. `src/lib/options.ts:59-72`; `src/context.ts:12-42`; `src/output/format.ts:82-95`; `src/commands/issue.ts:549-584`
- Blanket global-option injection is the central design mistake. It advertises capabilities commands do not honor and creates a dangerous `--no-color` versus entity `--color` collision. `src/cli.ts:102-120`; `src/commands/label.ts:40-84`; `src/services/label.ts:85-128`
- Some mutations can report apparent success despite `success:false` or a missing response entity. That is a high-severity agent-contract failure, not cosmetic output debt. `src/services/notification.ts:86-125`; `src/commands/notification.ts:38-99`; `src/services/issue.ts:392-456`
- For humans, theirs is clearly ahead on long-form output: terminal-width-aware tables, Unicode width handling, rendered Markdown, contextual empty states, and paging. Ours preserves all text but dumps raw Markdown directly into scrollback. `src/output/table.ts:19-111`; `src/commands/document.ts:43-60`; `linear-cli-reference/src/commands/issue/issue-view.ts:140-240`; `linear-cli-reference/src/utils/pager.ts:104-118`
- Ours is safer on the main curated destructive surface: one default-No confirmation helper refuses non-TTY execution without `--yes`. Important exceptions remain—credential logout, relation removal, raw GraphQL mutations, and document-content replacement. `src/lib/prompt.ts:17-23`; `src/commands/meta.ts:169-196`; `src/commands/issue.ts:475-520`; `src/commands/document.ts:100-122`
- Ours’ errors are better for scripts but worse for humans: stable codes and exits are useful, yet lookup failures rarely offer valid choices or a next command. Some broad catches also assign the wrong error class. `src/lib/errors.ts:20-59`; `src/lib/resolve.ts:27-130`; `src/services/document.ts:189-201`
- Bottom line: theirs currently wins human terminal ergonomics; ours can win agent ergonomics, but the false globals, prompting bug, and false-success mutations need fixing before the advertised “dependable for scripts and agents” claim is accurate.

Path convention below: unprefixed paths are ours; `linear-cli-reference/...` is theirs.

## 1. Command & flag naming

**Human.** Ours’ date vocabulary is concise but internally reasonable: issues use `--due`, projects/milestones/initiatives use `--target`, and cycles use interval endpoints `--start`/`--end`. Theirs’ `--due-date`, `--target-date`, and `--start-date` are easier to guess cold, but this is a discoverability preference rather than a serious inconsistency. `src/commands/issue.ts:161-174`; `src/commands/project.ts:89-93`; `src/commands/milestone.ts:72-75`; `src/commands/cycle.ts:60-67`; `linear-cli-reference/src/commands/project/project-create.ts:176-179`; `linear-cli-reference/src/commands/issue/issue-create.ts:443-449`

The genuinely confusing cases are:

- `--team` versus `--teams`. `project create` uses local `--teams` while global `--team` can act as its fallback; `project update` advertises both but reads only `--teams`, so `--team ENG --name X` silently updates the name without changing teams. Theirs consistently uses repeatable singular `--team`. `src/commands/project.ts:76-138`; `src/commands/project.ts:145-191`; `src/services/project.ts:214-232`; `linear-cli-reference/src/commands/project/project-create.ts:153-180`; `linear-cli-reference/src/commands/project/project-update.ts:55-83`
- Label semantics vary by resource. `issue update` has `--add-label`/`--remove-label`, `issue label` shortens those to `--add`/`--remove`, while `project update --label` and `initiative update --label` replace the entire set. `src/commands/issue.ts:225-240`; `src/commands/issue.ts:308-320`; `src/commands/project.ts:150-163`; `src/commands/initiative.ts:105-117`
- Projects call their status `--state`, while initiatives use `--status`; the project service actually resolves the value to `statusId`. Theirs consistently distinguishes issue state from project status. `src/commands/project.ts:31-43`; `src/commands/project.ts:89-93`; `src/services/project.ts:175-184`; `src/commands/initiative.ts:73-80`; `linear-cli-reference/src/commands/project/project-create.ts:171-179`
- Comments have two grammars: top-level `comment add|list|update|...`, plus singular `issue comment` for adding and plural `issue comments` for listing. Theirs has one predictable `issue comment add|list|update|delete` tree. `src/commands/comment.ts:25-125`; `src/commands/issue.ts:327-359`; `linear-cli-reference/src/commands/issue/issue-comment.ts:7-13`

**Short flags.** I found no conflicting reuse in ours: global `-t/-n/-f/-y/-q` retain one meaning, while common resource flags consistently use `-d` description, `-a` assignee, `-s` state, `-p` project, `-l` label, and `-P` priority. `src/lib/options.ts:59-88`; `src/commands/issue.ts:161-174`; `src/commands/project.ts:81-95`

Theirs reuses local shorts across commands—`-t` is title or team, `-a` is assignee/app/all/attach, and `-f` is a content file, description file, or VCS source ref. These do not collide in the parser because they are local, but they weaken human muscle memory. `linear-cli-reference/src/commands/issue/issue-create.ts:443-474`; `linear-cli-reference/src/commands/project/project-create.ts:153-179`; `linear-cli-reference/src/commands/issue/issue-start.ts:8-15`

**Agent/script.** Long names matter more than shorts. The silent `--team`/`--teams` behavior and changing label semantics are costly; whether dates end in `-date` is not.

## 2. Global vs local options

Ours recursively adds twelve globals to every descendant. `linear commands` then serializes every declared option, regardless of whether the handler can use it. `src/lib/options.ts:59-72`; `src/cli.ts:102-120`; `src/lib/introspect.ts:52-69`

This produces concrete silent no-ops:

- `linear commands --limit 1 --fields nonsense --team NOPE` still returns the full command tree successfully; the handler consumes none of those values. `src/commands/discover.ts:18-52`
- Workspace-scoped `initiative list --team X` ignores the team. `src/commands/initiative.ts:2-6`; `src/commands/initiative.ts:32-41`
- `project view --fields ...` ignores the selector because only list output applies fields. `src/output/format.ts:45-62`; `src/commands/project.ts:48-72`
- `issue view --comments --limit N` always fetches ten comments. `src/commands/issue.ts:598-604`
- `api --paginate --limit N` and `--all` ignore both controls and can continue to the 1,000-page cap. `src/commands/api.ts:47-55`; `src/commands/api.ts:121-155`
- `schema --json --output FILE` prints JSON to stdout and silently ignores the file. `src/commands/discover.ts:71-92`
- `auth login --api-key KEY` ignores the global key because the handler reads only local `--key`. `src/commands/meta.ts:53-76`

The worst interaction is `--no-color` versus local `--color <hex>`. Commander normalizes both to property `color`; on `label create/update`, a leaf-positioned `--no-color` becomes `opts.color === false`, and the label service forwards any non-`undefined` value to the API. Combining the two flags is order-dependent. `src/lib/options.ts:59-72`; `src/commands/label.ts:40-84`; `src/services/label.ts:85-128`

Theirs injects only credential `--workspace`; functional options are normally leaf-local and unsupported assumptions become unknown-option errors. `linear-cli-reference/src/main.ts:51-80`; `linear-cli-reference/src/main.ts:127-169` It is not perfect: `label list` reuses `--workspace` as a boolean scope filter and requires special shadowing logic. `linear-cli-reference/src/main.ts:132-169`; `linear-cli-reference/src/commands/label/label-list.ts:37-44`

The correct direction is capability bundles, not one global bundle: authentication/output flags where universally meaningful, pagination only on collections, fields only on projected output, confirmation only on gated mutations, and team scope only where consumed.

## 3. Output

**Tables.** Ours’ centralized renderer gives consistent spacing, truncation, empty-state behavior, and field selection. Unknown `--fields` values fail with the available keys, and requested order is preserved. `src/output/table.ts:37-59`

Its limitations are material for humans:

- Width is measured with JavaScript string length rather than terminal display width, so CJK, emoji, and combining characters can misalign. `src/output/table.ts:19-27`
- Each column is truncated against a fixed maximum—default 60—without budgeting against terminal width. A table can overflow a narrow terminal and remain unnecessarily truncated in a wide one. `src/output/table.ts:62-95`
- Empty lists always say `(no results)`, without naming the resource or active filter. `src/output/table.ts:62-69`
- Several tables omit the identifier needed for the next command. Comments omit comment ID; documents omit UUID and slug; notifications omit notification ID; projects omit project ID. `src/commands/comment.ts:19-23`; `src/commands/document.ts:17-21`; `src/commands/notification.ts:12-17`; `src/commands/project.ts:14-20` Because `--fields` selects only registered columns, `--fields id` cannot recover an omitted identifier. `src/output/table.ts:42-59`

Theirs uses terminal dimensions and `string-width`, and several important lists expose actionable IDs or slugs. `linear-cli-reference/src/utils/display.ts:1-16`; `linear-cli-reference/src/commands/initiative/initiative-list.ts:201-297`; `linear-cli-reference/src/commands/label/label-list.ts:141-198`; `linear-cli-reference/src/commands/document/document-list.ts:92-165` The tradeoff is duplicated per-command table code; ours is easier to keep consistent once its renderer is improved.

**Long text.** Ours prints descriptions, document content, and comments as raw Markdown inside aligned detail blocks. Nothing is lost, and non-TTY consumers receive stable plain text, but long documents flood scrollback and headings, lists, links, and code are not visually distinguished. `src/commands/issue.ts:598-625`; `src/commands/document.ts:43-60`; `src/commands/project.ts:48-72`

Theirs renders Markdown to terminal width and invokes a pager only when content exceeds terminal height; non-TTY output remains raw Markdown. `linear-cli-reference/src/commands/issue/issue-view.ts:140-240`; `linear-cli-reference/src/commands/document/document-view.ts:178-226`; `linear-cli-reference/src/utils/pager.ts:104-118` That is a significant human advantage for issue descriptions, comments, and documents, but almost no advantage for scripts using JSON/raw output.

Ours’ README claim that output is “paged sanely” is not matched by the implementation, which writes directly to stdout. `README.md:22-25`; `src/output/format.ts:45-66`

**Colour/TTY.** Ours correctly disables action output colour for JSON or non-TTY stdout. `src/context.ts:39-48` The `--no-color` parser collision undermines the explicit override on commands with entity colours. Theirs additionally makes `NO_COLOR` and non-TTY behavior explicit in its styling layer. `linear-cli-reference/src/utils/styling.ts:33-43`

**Agent/script.** JSON bypasses table projection and truncation, which is correct. `--fields` is useful for humans and lightweight text pipelines, but it should either work on detail output or not appear there.

## 4. The agent/scripting contract

The central architecture is good: lists pass through `Output.list`, single records through `detail`/`emit`, status goes to stderr, and errors are normalized at the process boundary. Exit codes 1–5 distinguish runtime, usage, not-found/ambiguous, auth, and rate limiting. `src/output/format.ts:1-100`; `src/bin/linear.ts:13-42`; `src/lib/errors.ts:5-59`

It is not honored everywhere:

- `--no-input` does not work. Commander stores negated `--no-input` as `input:false`, while `Context` checks `options.noInput`; a PTY probe still reached the title prompt. `src/lib/options.ts:59-72`; `src/context.ts:12-42`
- Prompt eligibility checks stdin only. `--json` or `... | jq` can therefore prompt if stdin remains a terminal even though stdout is piped. `src/context.ts:39-47`; `src/lib/prompt.ts:11-35`
- Declining a destructive prompt returns before any output call, producing exit 0 with empty stdout under `--json`. `src/commands/issue.ts:549-584`
- `--json --debug` writes the JSON error and then appends plaintext `detail: ...`, so stderr is no longer one parseable JSON value. `src/output/format.ts:82-95`
- `completion --json` emits shell source directly. The skill documents this exception, but machine discovery still advertises `--json` on that command. `src/commands/completion.ts:60-71`; `skills/linear-sdk-cli/SKILL.md:9-13`; `src/cli.ts:102-120`
- `issue comment` can emit an object without `id` if Linear returns no comment entity; the standalone comment service correctly treats the equivalent condition as failure. `src/services/issue.ts:453-456`; `src/commands/issue.ts:327-339`; `src/services/comment.ts:100-108`
- Scalar getters emit `{title}`, `{url}`, or `{branch}` without `id`/`identifier`, and relation-list rows omit relation UUID and related issue UUID. `src/commands/issue.ts:587-641`; `src/services/issue.ts:551-574`
- Notification read/unread/snooze commands discard the returned success flag and emit the requested state. `read-all` returns `success:true` unconditionally after sequential updates. Issue update falls back to the old object if the API supplies no updated issue, then prints “Updated.” `src/services/notification.ts:86-125`; `src/commands/notification.ts:38-99`; `src/services/issue.ts:392-430`

The existing contract tests verify the `Output` abstraction with `debug:false`; they do not execute every registered command or the `--json --debug` combination. `test/contract/json-envelope.test.ts:29-73`

**Cold discovery.** `linear commands --json` is a real advantage: it is deterministic, offline, and provides paths, aliases, argument requiredness, and option descriptions. `src/commands/discover.ts:18-52`; `src/lib/introspect.ts:8-69` But it omits option choices/defaults/repeatability/conflicts, argument descriptions, output kind, whether a command mutates or prompts, and whether a node is merely a group. Blanket globals make this incomplete schema actively misleading. `linear schema` is useful for the raw API but requires a live authenticated introspection request. `src/commands/discover.ts:55-93`

Theirs’ `AGENTS.md` is explicitly a contributor guide, not an end-user agent contract. Its skill supplies a static command list and tells agents to inspect `--help`, but there is no comparable live command manifest. `linear-cli-reference/AGENTS.md:1-13`; `linear-cli-reference/skills/linear-cli/SKILL.md:66-215`

Ours remains substantially better for agents overall. Theirs intentionally preserves GraphQL connection shapes, so list JSON varies between objects such as `{nodes,pageInfo}` rather than bare arrays, while all errors collapse to plaintext and exit 1. `linear-cli-reference/AGENTS.md:26-27`; `linear-cli-reference/src/commands/initiative/initiative-list.ts:156-198`; `linear-cli-reference/src/commands/document/document-list.ts:73-84`; `linear-cli-reference/src/utils/errors.ts:127-151`

## 5. Errors and failure modes

Ours’ error taxonomy is mechanically consistent but sometimes semantically wrong.

Good behavior:

- Parse, domain, SDK, and runtime failures share one boundary and stable machine codes. `src/bin/linear.ts:18-37`; `src/lib/errors.ts:20-59`
- Ambiguous team/user/label/project resolution refuses to guess, which is safer for agents. `src/lib/resolve.ts:41-48`; `src/lib/resolve.ts:58-67`; `src/lib/resolve.ts:94-130`; `src/lib/resolve.ts:215-224`
- Unknown workflow states list available state names. `src/lib/resolve.ts:70-86`

Weak behavior:

- Unknown teams, users, labels, projects, cycles, and milestones generally do not list valid choices or suggest the exact discovery command. `src/lib/resolve.ts:27-67`; `src/lib/resolve.ts:94-130`; `src/lib/resolve.ts:215-260`
- Project ambiguity can produce `Multiple projects match 'X': X, X`, without IDs, teams, or slugs to distinguish the candidates. `src/lib/resolve.ts:221-224`
- Broad catches rewrite unrelated failures. Document lookup turns any network/auth/server error into `No document matching '…'`; auth login turns every viewer/organization failure into `That API key was rejected by Linear.` `src/services/document.ts:189-201`; `src/commands/meta.ts:61-74`
- API invariant failures such as `Team creation returned no team.`, `Comment deletion failed.`, and `Status update creation returned no update.` are thrown as usage errors and therefore exit 2, even though the invocation may be valid. `src/services/team.ts:188-196`; `src/services/comment.ts:118-121`; `src/lib/status-update.ts:41-55`
- Browser opening ignores the subprocess callback error and always resolves, allowing `{opened:true}` after a failed opener. `src/commands/issue.ts:58-75`; `src/commands/issue.ts:685-689`

The worst messages are:

- `"(outputHelp)"` — emitted by bare groups such as `linear auth --json`, with exit 2 and no remedy. `src/cli.ts:123-128`; `src/bin/linear.ts:18-37`
- `"That API key was rejected by Linear."` — also used for transport/server failures. `src/commands/meta.ts:69-74`
- `"Comment deletion failed."` — no comment ID, API cause, or next action, and the wrong error class. `src/services/comment.ts:118-121`
- `"Multiple projects match 'X': X, X"` — ambiguity detected correctly but not resolved helpfully. `src/lib/resolve.ts:221-224`
- `"No label matching 'X'."` — no team/workspace scope, valid labels, or `linear label list` suggestion. `src/lib/resolve.ts:94-130`

Theirs has a richer human error object with context and a separate suggestion, and equivalent state/label failures can recommend valid choices or a list command. `linear-cli-reference/src/utils/errors.ts:24-79`; `linear-cli-reference/src/utils/errors.ts:127-151`; `linear-cli-reference/src/utils/linear.ts:176-195`; `linear-cli-reference/src/commands/issue/issue-update.ts:190-205` Ours should adopt that presentation while retaining its superior JSON codes and exit taxonomy.

## 6. Destructive operations & safety

Ours consistently gates the main curated destructive set:

- Delete: attachment, comment, document, label, milestone, roadmap, webhook, issue, and initiative.
- Archive: issue, initiative, project, and notification.
- Remove: favorite.

Representative handlers use the same helper, which bypasses only with `--yes`, defaults confirmation to No, and fails cleanly on non-TTY stdin rather than waiting. `src/lib/prompt.ts:17-23`; `src/commands/comment.ts:90-102`; `src/commands/document.ts:125-138`; `src/commands/issue.ts:547-584`; `src/commands/initiative.ts:140-168`; `src/commands/project.ts:198-210`

Ordinary creates/updates, assignments, state changes, comments, subscriptions, read/snooze operations, and restorative unarchives are ungated, which is reasonable.

Exceptions and inconsistencies:

- `auth logout` removes a stored credential and may repoint the default workspace without confirmation, even though global `--yes` is accepted. `src/commands/meta.ts:169-196`; `src/config.ts:321-342`
- `issue relation ... remove` deletes immediately, while `favorite remove` is gated. `src/commands/issue.ts:475-520`; `src/services/issue.ts:497-523`; `src/commands/favorite.ts:58-69`
- `notification read-all` changes an unbounded set sequentially; a mid-loop error leaves partial state with no completed/remaining receipt. `src/commands/notification.ts:64-72`; `src/services/notification.ts:100-112`
- `document update --content...` replaces Markdown without warning that active inline-comment anchors may be detached. `src/commands/document.ts:100-122`
- Raw `api` executes arbitrary GraphQL mutations without `--yes` or mutation detection. That is defensible as an expert escape hatch, but it should be documented as outside curated safety guarantees. `src/commands/api.ts:20-68`
- A human decline is safe for Linear but unsafe for the JSON protocol because it returns empty success. `src/commands/issue.ts:549-584`

Theirs is inconsistent in the other direction: issue archive and comment deletion are ungated, and team deletion can move every issue before asking for final deletion confirmation. `linear-cli-reference/src/commands/issue/issue-archive.ts:21-49`; `linear-cli-reference/src/commands/issue/issue-comment-delete.ts:6-26`; `linear-cli-reference/src/commands/team/team-delete.ts:72-131`

## 7. Interactive behavior

The intended model is sound—central TTY checks, flags first, file/stdin bodies, then an editor—but the implementation has several sharp edges.

- `--no-input` is ineffective because of the `input`/`noInput` mismatch. `src/lib/options.ts:59-72`; `src/context.ts:12-42`
- Only stdin TTY status is checked. If stdout is redirected or piped while stdin remains a terminal, prompts can still appear and block or pollute machine output. `src/context.ts:39-47`; `src/lib/prompt.ts:11-35`
- `auth login` uses ordinary visible input for the API key. Theirs uses a masked password prompt. `src/commands/meta.ts:55-76`; `src/lib/prompt.ts:25-35`; `linear-cli-reference/src/commands/auth/auth-login.ts:22-40`; `linear-cli-reference/src/utils/prompt.ts:148-165`
- Explicit `issue create --editor` is silently ignored outside a TTY, and creation continues without a description. `src/commands/issue.ts:158-214`
- `comment update <id>` opens an empty editor rather than loading the current body. Quitting unchanged produces `""`, which is submitted as the replacement and may clear the comment or fail at the API. `src/commands/comment.ts:73-86`; `src/lib/body.ts:25-29`; `src/lib/body.ts:49-57`
- Inline text silently wins over a simultaneously supplied file/editor source. Contradictory explicit inputs should be rejected. `src/lib/body.ts:25-29`; `src/commands/issue.ts:161-194`
- `$EDITOR="code --wait"` is passed as one executable name and fails. Theirs has the same defect. `src/lib/body.ts:49-58`; `linear-cli-reference/src/utils/editor.ts:7-23`; `linear-cli-reference/src/utils/editor.ts:43-53`
- Raw `api` synchronously reads fd 0 whenever stdin is non-TTY and no query source is supplied. An open but empty pipe can block indefinitely; theirs bounds implicit stdin probing. `src/commands/api.ts:81-89`; `src/lib/body.ts:41-46`; `linear-cli-reference/src/commands/api.ts:260-300`

For humans, theirs offers much more useful guided interaction: searchable team selection, optional-field prompts, editor composition, and a default-No “start now” step during issue creation. `linear-cli-reference/src/commands/issue/issue-create.ts:291-424` Its document editor seeds current content and cancels unchanged edits. `linear-cli-reference/src/commands/document/document-update.ts:238-271`

For agents, ours’ centralized guard would be better once fixed. Theirs still has commands that invoke auth/comment/start prompts without a general stdin-TTY gate. `linear-cli-reference/src/commands/auth/auth-login.ts:22-40`; `linear-cli-reference/src/commands/auth/auth-logout.ts:25-50`; `linear-cli-reference/src/commands/issue/issue-start.ts:28-57`

## 8. Docs & discoverability

Ours’ README is strong at the top level: installation, quickstart, core concepts, workflows, group overview, JSON contract, exit codes, and discovery are all presented in a logical order. `README.md:32-170`; `README.md:198-288`

The fastest human path breaks in several places:

- The README says every group has help, but invoking many bare groups yields `error: (outputHelp)` rather than useful help. `README.md:166-170`; `src/cli.ts:123-128`; `src/bin/linear.ts:18-37`
- Every help page is swollen by globals that may do nothing on that command. `src/cli.ts:102-120`
- The generated skill explicitly tells agents that every command accepts all globals, carrying the false affordance into secondary documentation. `skills/linear-sdk-cli/scripts/generate-docs.ts:142-165`
- The README claims “paged sanely,” but there is no paging in the output path. `README.md:22-25`; `src/output/format.ts:45-66`
- The repository contains a useful skill, but the npm `files` list excludes `skills/`, so a normal package installation does not actually include it. `README.md:286-288`; `package.json:30-35`

Theirs’ source repository includes both an end-user skill and a detailed contributor `AGENTS.md`. The latter should not be mistaken for a runtime agent guide—it explicitly describes repository development. `linear-cli-reference/AGENTS.md:1-14` Its skill is helpful but static and ultimately directs agents back to repeated `--help` calls. `linear-cli-reference/skills/linear-cli/SKILL.md:66-215` Its npm package likewise excludes the skill and `AGENTS.md`. `linear-cli-reference/package.json:6-12`

Theirs also has documentation drift: `docs/usage.md` still recommends `issue list --assignee`, `--unassigned`, and `--all-assignees`, while source marks those flags removed and directs users to `issue query`. `linear-cli-reference/docs/usage.md:40-54`; `linear-cli-reference/src/commands/issue/issue-mine.ts:73-83`; `linear-cli-reference/src/commands/issue/issue-mine.ts:116-123`

For a cold agent, ours is ahead because `linear commands --json` avoids help scraping. Its next improvement should be an honest manifest containing option types/choices/defaults, conflicts, output shapes, prompt behavior, and mutation/destructive metadata.

## Findings

| severity | area | what's wrong | evidence (`file:line`) | suggested fix |
|---|---|---|---|---|
| high | interactive / agent contract | `--no-input` maps to `input:false`, but `Context` checks `noInput`; TTY-backed agents still prompt. JSON/piped stdout does not disable prompting. | `src/lib/options.ts:59-72`; `src/context.ts:12-47`; `src/lib/prompt.ts:11-35` | Read the Commander property correctly; make JSON or non-TTY stdout noninteractive unless explicitly opted in; add PTY tests. |
| high | global/local options | Global `--no-color` collides with entity `--color`; label mutations can forward boolean `false` as the API colour. | `src/lib/options.ts:59-72`; `src/commands/label.ts:40-84`; `src/services/label.ts:85-128` | Use a distinct internal property/flag such as `--no-ansi`, and add parser-collision tests. |
| high | agent contract | Mutations can emit requested/success-looking state after `success:false` or missing response entities. | `src/services/notification.ts:86-125`; `src/commands/notification.ts:38-99`; `src/services/issue.ts:392-456` | Centralize mutation unwrapping; require `success === true` and expected entities before emitting success. |
| high | global/local options | `project update --team ENG` is silently ignored while sibling create can consume global `--team` as a fallback. | `src/commands/project.ts:76-138`; `src/commands/project.ts:145-191`; `src/services/project.ts:214-232` | Use repeatable singular local `--team` consistently, or reject the global flag on update. |
| high | interactive / credentials | API keys are collected through visible text input. | `src/commands/meta.ts:53-76`; `src/lib/prompt.ts:25-35` | Add a masked secret/password prompt. |
| medium | global/local options | All twelve globals are injected and advertised even when handlers ignore them; discovery therefore lies about capabilities. | `src/cli.ts:102-120`; `src/lib/introspect.ts:52-69`; `src/commands/initiative.ts:32-41`; `src/commands/api.ts:47-55` | Replace blanket injection with capability-specific option bundles and expose applicability in discovery. |
| medium | naming / auth | `auth login` declares `--key` but also advertises ignored global `--api-key`. | `src/lib/options.ts:61-71`; `src/commands/meta.ts:53-76` | Consume one canonical `--api-key`; retain `--key` only as a deprecated alias. |
| medium | JSON contract | `--json --debug` appends plaintext after the error object. | `src/output/format.ts:82-95`; `test/contract/json-envelope.test.ts:29-73` | Put debug data inside `error.detail`, or suppress it in JSON mode. |
| medium | JSON contract | Declining confirmation exits 0 with no JSON; `completion --json` emits shell code; `schema --json --output` ignores the file. | `src/commands/issue.ts:549-584`; `src/commands/completion.ts:60-71`; `src/commands/discover.ts:71-92` | Emit a cancellation receipt; omit/reject inapplicable JSON flags; compose schema format and destination independently. |
| medium | errors / discoverability | Bare command groups return `"(outputHelp)"` instead of help or an actionable missing-subcommand error. | `src/cli.ts:123-128`; `src/bin/linear.ts:18-37` | Give groups a help action or translate Commander’s help exception to normal help and exit 0. |
| medium | output | Tables ignore terminal width/Unicode display width, use generic empty states, and omit actionable IDs from several resource lists. | `src/output/table.ts:19-95`; `src/commands/comment.ts:19-23`; `src/commands/document.ts:17-21`; `src/commands/notification.ts:12-17` | Use `string-width`, terminal budgeting, contextual empty messages, and include stable ID/slug columns. |
| medium | output | `--fields` is documented for table/detail output but only affects lists; long Markdown has no rendering or pager. | `src/output/format.ts:16-62`; `src/commands/project.ts:48-72`; `src/commands/document.ts:43-60` | Implement detail projection or restrict the option; add TTY Markdown rendering and threshold paging. |
| medium | errors | Broad catches misclassify network/server failures as not-found or invalid credentials; API invariants are classified as usage errors. | `src/services/document.ts:189-201`; `src/commands/meta.ts:61-74`; `src/services/team.ts:188-196`; `src/lib/status-update.ts:41-55` | Catch only known error types/statuses; use `api`/`network` for invariant and transport failures. |
| medium | errors | Most resolution failures do not list valid options or suggest a discovery command; ambiguity candidates may be indistinguishable. | `src/lib/resolve.ts:27-67`; `src/lib/resolve.ts:94-130`; `src/lib/resolve.ts:215-260` | Add structured suggestion/context fields; show IDs, scope, and exact list commands. |
| medium | destructive safety | Document content replacement can detach inline-comment anchors without warning. | `src/commands/document.ts:100-122`; `linear-cli-reference/src/commands/document/document-update.ts:294-310` | Detect active inline comments and require an explicit `--force`. |
| medium | destructive safety | `auth logout` removes/repoints credentials without confirmation. | `src/commands/meta.ts:169-196`; `src/config.ts:321-342` | Confirm the exact workspace and resulting default; honor `--yes`. |
| medium | failure atomicity | `issue start --move/--state` mutates Linear before branch checkout, so checkout failure leaves remote state changed. | `src/services/issue.ts:480-494`; `src/commands/issue.ts:379-389`; `src/git.ts:89-98` | Preflight/perform checkout first, or return a structured partial-success receipt and rollback where possible. |
| medium | editor UX | Comment update edits an empty template; explicit `issue create --editor` is silently ignored outside a TTY. | `src/commands/comment.ts:73-86`; `src/lib/body.ts:25-57`; `src/commands/issue.ts:158-214` | Seed current content, cancel unchanged/empty edits, and fail when explicitly requested interaction is unavailable. |
| medium | stdin behavior | Raw API implicitly performs an unbounded synchronous stdin read and can wait forever on an open empty pipe. | `src/commands/api.ts:81-89`; `src/lib/body.ts:41-46` | Use bounded async probing; reserve unbounded reads for explicit `--query-file -`. |
| medium | docs / distribution | README promises sane paging and a shipped skill, but paging is absent and npm excludes the skill. | `README.md:22-25`; `README.md:286-288`; `package.json:30-35` | Correct the paging claim; include `skills/` in the package or document repository-only installation. |
| low | naming | Project `--state` versus initiative `--status`, changing label verbs, and two comment hierarchies reduce predictability. | `src/commands/project.ts:35-43`; `src/commands/initiative.ts:73-80`; `src/commands/issue.ts:308-359`; `src/commands/comment.ts:25-125` | Standardize domain nouns and use one comment/label mutation grammar. |
| low | body/editor input | Contradictory body sources are silently prioritized, and editor values containing arguments are treated as one executable. | `src/lib/body.ts:25-29`; `src/lib/body.ts:49-58` | Reject mutually exclusive sources and safely parse editor executable plus arguments. |
| low | destructive consistency | Relation removal is ungated; raw API mutations bypass all confirmation; read-all lacks a partial-success receipt. | `src/commands/issue.ts:475-520`; `src/commands/api.ts:20-68`; `src/services/notification.ts:100-112` | Gate or explicitly document unlinking/raw-API exceptions; return completed/remaining counts for bulk operations. |

## Where theirs is better than ours

- Functional options are local, so help is more truthful and unsupported flags generally fail instead of doing nothing. `linear-cli-reference/src/main.ts:127-169`
- Long-form human output is substantially better: terminal-width Markdown rendering, conditional paging, contextual empty states, relative times, and Unicode-aware widths. `linear-cli-reference/src/commands/issue/issue-view.ts:140-240`; `linear-cli-reference/src/utils/pager.ts:104-118`; `linear-cli-reference/src/utils/display.ts:1-57`
- Human interaction is richer: guided issue creation, masked API-key input, current-content editing, unchanged-edit cancellation, and document inline-comment protection. `linear-cli-reference/src/commands/issue/issue-create.ts:291-424`; `linear-cli-reference/src/commands/auth/auth-login.ts:22-40`; `linear-cli-reference/src/commands/document/document-update.ts:238-310`
- Error presentation supports separate context and remediation, and some resolution failures name valid choices or exact follow-up commands. `linear-cli-reference/src/utils/errors.ts:24-79`; `linear-cli-reference/src/utils/errors.ts:127-151`; `linear-cli-reference/src/utils/linear.ts:176-195`
- Bare groups deliberately show help, and explicit date names are easier to discover cold. `linear-cli-reference/src/commands/issue/issue.ts:23-46`; `linear-cli-reference/src/commands/issue/issue-comment.ts:7-13`; `linear-cli-reference/src/commands/project/project-create.ts:176-179`

## Where ours is better than theirs

- The intended scripting protocol is much stronger: uniform bare arrays/objects, structured stderr errors, stable fine-grained codes, and distinct exit statuses. Theirs preserves varying GraphQL connection shapes and exits 1 for every handled failure. `src/output/format.ts:1-100`; `src/lib/errors.ts:20-59`; `linear-cli-reference/AGENTS.md:26-27`; `linear-cli-reference/src/utils/errors.ts:127-151`
- `linear commands --json` and `linear schema` provide live machine discovery rather than requiring an agent to scrape a static skill and repeated help pages. `src/commands/discover.ts:18-93`; `src/lib/introspect.ts:28-69`
- Curated delete/archive operations follow one default-No confirmation policy and refuse non-TTY execution without `--yes`. Theirs silently archives issues and deletes comments, and its team-delete flow can move issues before final confirmation. `src/lib/prompt.ts:17-23`; `src/commands/issue.ts:547-584`; `linear-cli-reference/src/commands/issue/issue-archive.ts:21-49`; `linear-cli-reference/src/commands/team/team-delete.ts:72-131`
- Ours’ short flags have much better cross-command semantic consistency. `src/lib/options.ts:59-88`; `src/commands/issue.ts:161-174`
- Ours centralizes table/detail/error output and provides a case-insensitive, ordered `--fields` selector with actionable unknown-field errors; theirs duplicates output logic and has no equivalent general projection facility. `src/output/format.ts:25-100`; `src/output/table.ts:37-59`
- Ours refuses ambiguous team/user/project/label matches rather than silently choosing a candidate, which is safer for agents. `src/lib/resolve.ts:41-48`; `src/lib/resolve.ts:58-67`; `src/lib/resolve.ts:94-130`; `src/lib/resolve.ts:215-224`
tokens used
707,047
## Verdict

- Ours has the stronger foundation for agents: centralized bare-array/object JSON, structured stderr errors, distinct exit codes, and live command/schema discovery. Theirs has no comparable uniform contract. `src/output/format.ts:1-10`; `src/lib/errors.ts:5-46`; `src/commands/discover.ts:18-93`; `linear-cli-reference/AGENTS.md:26-27`
- That contract is not yet dependable: `--no-input` is miswired and still prompts in a TTY; a declined destructive prompt exits 0 with no JSON; `--json --debug` appends plaintext to the error envelope. `src/lib/options.ts:59-72`; `src/context.ts:12-42`; `src/output/format.ts:82-95`; `src/commands/issue.ts:549-584`
- Blanket global-option injection is the central design mistake. It advertises capabilities commands do not honor and creates a dangerous `--no-color` versus entity `--color` collision. `src/cli.ts:102-120`; `src/commands/label.ts:40-84`; `src/services/label.ts:85-128`
- Some mutations can report apparent success despite `success:false` or a missing response entity. That is a high-severity agent-contract failure, not cosmetic output debt. `src/services/notification.ts:86-125`; `src/commands/notification.ts:38-99`; `src/services/issue.ts:392-456`
- For humans, theirs is clearly ahead on long-form output: terminal-width-aware tables, Unicode width handling, rendered Markdown, contextual empty states, and paging. Ours preserves all text but dumps raw Markdown directly into scrollback. `src/output/table.ts:19-111`; `src/commands/document.ts:43-60`; `linear-cli-reference/src/commands/issue/issue-view.ts:140-240`; `linear-cli-reference/src/utils/pager.ts:104-118`
- Ours is safer on the main curated destructive surface: one default-No confirmation helper refuses non-TTY execution without `--yes`. Important exceptions remain—credential logout, relation removal, raw GraphQL mutations, and document-content replacement. `src/lib/prompt.ts:17-23`; `src/commands/meta.ts:169-196`; `src/commands/issue.ts:475-520`; `src/commands/document.ts:100-122`
- Ours’ errors are better for scripts but worse for humans: stable codes and exits are useful, yet lookup failures rarely offer valid choices or a next command. Some broad catches also assign the wrong error class. `src/lib/errors.ts:20-59`; `src/lib/resolve.ts:27-130`; `src/services/document.ts:189-201`
- Bottom line: theirs currently wins human terminal ergonomics; ours can win agent ergonomics, but the false globals, prompting bug, and false-success mutations need fixing before the advertised “dependable for scripts and agents” claim is accurate.

Path convention below: unprefixed paths are ours; `linear-cli-reference/...` is theirs.

## 1. Command & flag naming

**Human.** Ours’ date vocabulary is concise but internally reasonable: issues use `--due`, projects/milestones/initiatives use `--target`, and cycles use interval endpoints `--start`/`--end`. Theirs’ `--due-date`, `--target-date`, and `--start-date` are easier to guess cold, but this is a discoverability preference rather than a serious inconsistency. `src/commands/issue.ts:161-174`; `src/commands/project.ts:89-93`; `src/commands/milestone.ts:72-75`; `src/commands/cycle.ts:60-67`; `linear-cli-reference/src/commands/project/project-create.ts:176-179`; `linear-cli-reference/src/commands/issue/issue-create.ts:443-449`

The genuinely confusing cases are:

- `--team` versus `--teams`. `project create` uses local `--teams` while global `--team` can act as its fallback; `project update` advertises both but reads only `--teams`, so `--team ENG --name X` silently updates the name without changing teams. Theirs consistently uses repeatable singular `--team`. `src/commands/project.ts:76-138`; `src/commands/project.ts:145-191`; `src/services/project.ts:214-232`; `linear-cli-reference/src/commands/project/project-create.ts:153-180`; `linear-cli-reference/src/commands/project/project-update.ts:55-83`
- Label semantics vary by resource. `issue update` has `--add-label`/`--remove-label`, `issue label` shortens those to `--add`/`--remove`, while `project update --label` and `initiative update --label` replace the entire set. `src/commands/issue.ts:225-240`; `src/commands/issue.ts:308-320`; `src/commands/project.ts:150-163`; `src/commands/initiative.ts:105-117`
- Projects call their status `--state`, while initiatives use `--status`; the project service actually resolves the value to `statusId`. Theirs consistently distinguishes issue state from project status. `src/commands/project.ts:31-43`; `src/commands/project.ts:89-93`; `src/services/project.ts:175-184`; `src/commands/initiative.ts:73-80`; `linear-cli-reference/src/commands/project/project-create.ts:171-179`
- Comments have two grammars: top-level `comment add|list|update|...`, plus singular `issue comment` for adding and plural `issue comments` for listing. Theirs has one predictable `issue comment add|list|update|delete` tree. `src/commands/comment.ts:25-125`; `src/commands/issue.ts:327-359`; `linear-cli-reference/src/commands/issue/issue-comment.ts:7-13`

**Short flags.** I found no conflicting reuse in ours: global `-t/-n/-f/-y/-q` retain one meaning, while common resource flags consistently use `-d` description, `-a` assignee, `-s` state, `-p` project, `-l` label, and `-P` priority. `src/lib/options.ts:59-88`; `src/commands/issue.ts:161-174`; `src/commands/project.ts:81-95`

Theirs reuses local shorts across commands—`-t` is title or team, `-a` is assignee/app/all/attach, and `-f` is a content file, description file, or VCS source ref. These do not collide in the parser because they are local, but they weaken human muscle memory. `linear-cli-reference/src/commands/issue/issue-create.ts:443-474`; `linear-cli-reference/src/commands/project/project-create.ts:153-179`; `linear-cli-reference/src/commands/issue/issue-start.ts:8-15`

**Agent/script.** Long names matter more than shorts. The silent `--team`/`--teams` behavior and changing label semantics are costly; whether dates end in `-date` is not.

## 2. Global vs local options

Ours recursively adds twelve globals to every descendant. `linear commands` then serializes every declared option, regardless of whether the handler can use it. `src/lib/options.ts:59-72`; `src/cli.ts:102-120`; `src/lib/introspect.ts:52-69`

This produces concrete silent no-ops:

- `linear commands --limit 1 --fields nonsense --team NOPE` still returns the full command tree successfully; the handler consumes none of those values. `src/commands/discover.ts:18-52`
- Workspace-scoped `initiative list --team X` ignores the team. `src/commands/initiative.ts:2-6`; `src/commands/initiative.ts:32-41`
- `project view --fields ...` ignores the selector because only list output applies fields. `src/output/format.ts:45-62`; `src/commands/project.ts:48-72`
- `issue view --comments --limit N` always fetches ten comments. `src/commands/issue.ts:598-604`
- `api --paginate --limit N` and `--all` ignore both controls and can continue to the 1,000-page cap. `src/commands/api.ts:47-55`; `src/commands/api.ts:121-155`
- `schema --json --output FILE` prints JSON to stdout and silently ignores the file. `src/commands/discover.ts:71-92`
- `auth login --api-key KEY` ignores the global key because the handler reads only local `--key`. `src/commands/meta.ts:53-76`

The worst interaction is `--no-color` versus local `--color <hex>`. Commander normalizes both to property `color`; on `label create/update`, a leaf-positioned `--no-color` becomes `opts.color === false`, and the label service forwards any non-`undefined` value to the API. Combining the two flags is order-dependent. `src/lib/options.ts:59-72`; `src/commands/label.ts:40-84`; `src/services/label.ts:85-128`

Theirs injects only credential `--workspace`; functional options are normally leaf-local and unsupported assumptions become unknown-option errors. `linear-cli-reference/src/main.ts:51-80`; `linear-cli-reference/src/main.ts:127-169` It is not perfect: `label list` reuses `--workspace` as a boolean scope filter and requires special shadowing logic. `linear-cli-reference/src/main.ts:132-169`; `linear-cli-reference/src/commands/label/label-list.ts:37-44`

The correct direction is capability bundles, not one global bundle: authentication/output flags where universally meaningful, pagination only on collections, fields only on projected output, confirmation only on gated mutations, and team scope only where consumed.

## 3. Output

**Tables.** Ours’ centralized renderer gives consistent spacing, truncation, empty-state behavior, and field selection. Unknown `--fields` values fail with the available keys, and requested order is preserved. `src/output/table.ts:37-59`

Its limitations are material for humans:

- Width is measured with JavaScript string length rather than terminal display width, so CJK, emoji, and combining characters can misalign. `src/output/table.ts:19-27`
- Each column is truncated against a fixed maximum—default 60—without budgeting against terminal width. A table can overflow a narrow terminal and remain unnecessarily truncated in a wide one. `src/output/table.ts:62-95`
- Empty lists always say `(no results)`, without naming the resource or active filter. `src/output/table.ts:62-69`
- Several tables omit the identifier needed for the next command. Comments omit comment ID; documents omit UUID and slug; notifications omit notification ID; projects omit project ID. `src/commands/comment.ts:19-23`; `src/commands/document.ts:17-21`; `src/commands/notification.ts:12-17`; `src/commands/project.ts:14-20` Because `--fields` selects only registered columns, `--fields id` cannot recover an omitted identifier. `src/output/table.ts:42-59`

Theirs uses terminal dimensions and `string-width`, and several important lists expose actionable IDs or slugs. `linear-cli-reference/src/utils/display.ts:1-16`; `linear-cli-reference/src/commands/initiative/initiative-list.ts:201-297`; `linear-cli-reference/src/commands/label/label-list.ts:141-198`; `linear-cli-reference/src/commands/document/document-list.ts:92-165` The tradeoff is duplicated per-command table code; ours is easier to keep consistent once its renderer is improved.

**Long text.** Ours prints descriptions, document content, and comments as raw Markdown inside aligned detail blocks. Nothing is lost, and non-TTY consumers receive stable plain text, but long documents flood scrollback and headings, lists, links, and code are not visually distinguished. `src/commands/issue.ts:598-625`; `src/commands/document.ts:43-60`; `src/commands/project.ts:48-72`

Theirs renders Markdown to terminal width and invokes a pager only when content exceeds terminal height; non-TTY output remains raw Markdown. `linear-cli-reference/src/commands/issue/issue-view.ts:140-240`; `linear-cli-reference/src/commands/document/document-view.ts:178-226`; `linear-cli-reference/src/utils/pager.ts:104-118` That is a significant human advantage for issue descriptions, comments, and documents, but almost no advantage for scripts using JSON/raw output.

Ours’ README claim that output is “paged sanely” is not matched by the implementation, which writes directly to stdout. `README.md:22-25`; `src/output/format.ts:45-66`

**Colour/TTY.** Ours correctly disables action output colour for JSON or non-TTY stdout. `src/context.ts:39-48` The `--no-color` parser collision undermines the explicit override on commands with entity colours. Theirs additionally makes `NO_COLOR` and non-TTY behavior explicit in its styling layer. `linear-cli-reference/src/utils/styling.ts:33-43`

**Agent/script.** JSON bypasses table projection and truncation, which is correct. `--fields` is useful for humans and lightweight text pipelines, but it should either work on detail output or not appear there.

## 4. The agent/scripting contract

The central architecture is good: lists pass through `Output.list`, single records through `detail`/`emit`, status goes to stderr, and errors are normalized at the process boundary. Exit codes 1–5 distinguish runtime, usage, not-found/ambiguous, auth, and rate limiting. `src/output/format.ts:1-100`; `src/bin/linear.ts:13-42`; `src/lib/errors.ts:5-59`

It is not honored everywhere:

- `--no-input` does not work. Commander stores negated `--no-input` as `input:false`, while `Context` checks `options.noInput`; a PTY probe still reached the title prompt. `src/lib/options.ts:59-72`; `src/context.ts:12-42`
- Prompt eligibility checks stdin only. `--json` or `... | jq` can therefore prompt if stdin remains a terminal even though stdout is piped. `src/context.ts:39-47`; `src/lib/prompt.ts:11-35`
- Declining a destructive prompt returns before any output call, producing exit 0 with empty stdout under `--json`. `src/commands/issue.ts:549-584`
- `--json --debug` writes the JSON error and then appends plaintext `detail: ...`, so stderr is no longer one parseable JSON value. `src/output/format.ts:82-95`
- `completion --json` emits shell source directly. The skill documents this exception, but machine discovery still advertises `--json` on that command. `src/commands/completion.ts:60-71`; `skills/linear-sdk-cli/SKILL.md:9-13`; `src/cli.ts:102-120`
- `issue comment` can emit an object without `id` if Linear returns no comment entity; the standalone comment service correctly treats the equivalent condition as failure. `src/services/issue.ts:453-456`; `src/commands/issue.ts:327-339`; `src/services/comment.ts:100-108`
- Scalar getters emit `{title}`, `{url}`, or `{branch}` without `id`/`identifier`, and relation-list rows omit relation UUID and related issue UUID. `src/commands/issue.ts:587-641`; `src/services/issue.ts:551-574`
- Notification read/unread/snooze commands discard the returned success flag and emit the requested state. `read-all` returns `success:true` unconditionally after sequential updates. Issue update falls back to the old object if the API supplies no updated issue, then prints “Updated.” `src/services/notification.ts:86-125`; `src/commands/notification.ts:38-99`; `src/services/issue.ts:392-430`

The existing contract tests verify the `Output` abstraction with `debug:false`; they do not execute every registered command or the `--json --debug` combination. `test/contract/json-envelope.test.ts:29-73`

**Cold discovery.** `linear commands --json` is a real advantage: it is deterministic, offline, and provides paths, aliases, argument requiredness, and option descriptions. `src/commands/discover.ts:18-52`; `src/lib/introspect.ts:8-69` But it omits option choices/defaults/repeatability/conflicts, argument descriptions, output kind, whether a command mutates or prompts, and whether a node is merely a group. Blanket globals make this incomplete schema actively misleading. `linear schema` is useful for the raw API but requires a live authenticated introspection request. `src/commands/discover.ts:55-93`

Theirs’ `AGENTS.md` is explicitly a contributor guide, not an end-user agent contract. Its skill supplies a static command list and tells agents to inspect `--help`, but there is no comparable live command manifest. `linear-cli-reference/AGENTS.md:1-13`; `linear-cli-reference/skills/linear-cli/SKILL.md:66-215`

Ours remains substantially better for agents overall. Theirs intentionally preserves GraphQL connection shapes, so list JSON varies between objects such as `{nodes,pageInfo}` rather than bare arrays, while all errors collapse to plaintext and exit 1. `linear-cli-reference/AGENTS.md:26-27`; `linear-cli-reference/src/commands/initiative/initiative-list.ts:156-198`; `linear-cli-reference/src/commands/document/document-list.ts:73-84`; `linear-cli-reference/src/utils/errors.ts:127-151`

## 5. Errors and failure modes

Ours’ error taxonomy is mechanically consistent but sometimes semantically wrong.

Good behavior:

- Parse, domain, SDK, and runtime failures share one boundary and stable machine codes. `src/bin/linear.ts:18-37`; `src/lib/errors.ts:20-59`
- Ambiguous team/user/label/project resolution refuses to guess, which is safer for agents. `src/lib/resolve.ts:41-48`; `src/lib/resolve.ts:58-67`; `src/lib/resolve.ts:94-130`; `src/lib/resolve.ts:215-224`
- Unknown workflow states list available state names. `src/lib/resolve.ts:70-86`

Weak behavior:

- Unknown teams, users, labels, projects, cycles, and milestones generally do not list valid choices or suggest the exact discovery command. `src/lib/resolve.ts:27-67`; `src/lib/resolve.ts:94-130`; `src/lib/resolve.ts:215-260`
- Project ambiguity can produce `Multiple projects match 'X': X, X`, without IDs, teams, or slugs to distinguish the candidates. `src/lib/resolve.ts:221-224`
- Broad catches rewrite unrelated failures. Document lookup turns any network/auth/server error into `No document matching '…'`; auth login turns every viewer/organization failure into `That API key was rejected by Linear.` `src/services/document.ts:189-201`; `src/commands/meta.ts:61-74`
- API invariant failures such as `Team creation returned no team.`, `Comment deletion failed.`, and `Status update creation returned no update.` are thrown as usage errors and therefore exit 2, even though the invocation may be valid. `src/services/team.ts:188-196`; `src/services/comment.ts:118-121`; `src/lib/status-update.ts:41-55`
- Browser opening ignores the subprocess callback error and always resolves, allowing `{opened:true}` after a failed opener. `src/commands/issue.ts:58-75`; `src/commands/issue.ts:685-689`

The worst messages are:

- `"(outputHelp)"` — emitted by bare groups such as `linear auth --json`, with exit 2 and no remedy. `src/cli.ts:123-128`; `src/bin/linear.ts:18-37`
- `"That API key was rejected by Linear."` — also used for transport/server failures. `src/commands/meta.ts:69-74`
- `"Comment deletion failed."` — no comment ID, API cause, or next action, and the wrong error class. `src/services/comment.ts:118-121`
- `"Multiple projects match 'X': X, X"` — ambiguity detected correctly but not resolved helpfully. `src/lib/resolve.ts:221-224`
- `"No label matching 'X'."` — no team/workspace scope, valid labels, or `linear label list` suggestion. `src/lib/resolve.ts:94-130`

Theirs has a richer human error object with context and a separate suggestion, and equivalent state/label failures can recommend valid choices or a list command. `linear-cli-reference/src/utils/errors.ts:24-79`; `linear-cli-reference/src/utils/errors.ts:127-151`; `linear-cli-reference/src/utils/linear.ts:176-195`; `linear-cli-reference/src/commands/issue/issue-update.ts:190-205` Ours should adopt that presentation while retaining its superior JSON codes and exit taxonomy.

## 6. Destructive operations & safety

Ours consistently gates the main curated destructive set:

- Delete: attachment, comment, document, label, milestone, roadmap, webhook, issue, and initiative.
- Archive: issue, initiative, project, and notification.
- Remove: favorite.

Representative handlers use the same helper, which bypasses only with `--yes`, defaults confirmation to No, and fails cleanly on non-TTY stdin rather than waiting. `src/lib/prompt.ts:17-23`; `src/commands/comment.ts:90-102`; `src/commands/document.ts:125-138`; `src/commands/issue.ts:547-584`; `src/commands/initiative.ts:140-168`; `src/commands/project.ts:198-210`

Ordinary creates/updates, assignments, state changes, comments, subscriptions, read/snooze operations, and restorative unarchives are ungated, which is reasonable.

Exceptions and inconsistencies:

- `auth logout` removes a stored credential and may repoint the default workspace without confirmation, even though global `--yes` is accepted. `src/commands/meta.ts:169-196`; `src/config.ts:321-342`
- `issue relation ... remove` deletes immediately, while `favorite remove` is gated. `src/commands/issue.ts:475-520`; `src/services/issue.ts:497-523`; `src/commands/favorite.ts:58-69`
- `notification read-all` changes an unbounded set sequentially; a mid-loop error leaves partial state with no completed/remaining receipt. `src/commands/notification.ts:64-72`; `src/services/notification.ts:100-112`
- `document update --content...` replaces Markdown without warning that active inline-comment anchors may be detached. `src/commands/document.ts:100-122`
- Raw `api` executes arbitrary GraphQL mutations without `--yes` or mutation detection. That is defensible as an expert escape hatch, but it should be documented as outside curated safety guarantees. `src/commands/api.ts:20-68`
- A human decline is safe for Linear but unsafe for the JSON protocol because it returns empty success. `src/commands/issue.ts:549-584`

Theirs is inconsistent in the other direction: issue archive and comment deletion are ungated, and team deletion can move every issue before asking for final deletion confirmation. `linear-cli-reference/src/commands/issue/issue-archive.ts:21-49`; `linear-cli-reference/src/commands/issue/issue-comment-delete.ts:6-26`; `linear-cli-reference/src/commands/team/team-delete.ts:72-131`

## 7. Interactive behavior

The intended model is sound—central TTY checks, flags first, file/stdin bodies, then an editor—but the implementation has several sharp edges.

- `--no-input` is ineffective because of the `input`/`noInput` mismatch. `src/lib/options.ts:59-72`; `src/context.ts:12-42`
- Only stdin TTY status is checked. If stdout is redirected or piped while stdin remains a terminal, prompts can still appear and block or pollute machine output. `src/context.ts:39-47`; `src/lib/prompt.ts:11-35`
- `auth login` uses ordinary visible input for the API key. Theirs uses a masked password prompt. `src/commands/meta.ts:55-76`; `src/lib/prompt.ts:25-35`; `linear-cli-reference/src/commands/auth/auth-login.ts:22-40`; `linear-cli-reference/src/utils/prompt.ts:148-165`
- Explicit `issue create --editor` is silently ignored outside a TTY, and creation continues without a description. `src/commands/issue.ts:158-214`
- `comment update <id>` opens an empty editor rather than loading the current body. Quitting unchanged produces `""`, which is submitted as the replacement and may clear the comment or fail at the API. `src/commands/comment.ts:73-86`; `src/lib/body.ts:25-29`; `src/lib/body.ts:49-57`
- Inline text silently wins over a simultaneously supplied file/editor source. Contradictory explicit inputs should be rejected. `src/lib/body.ts:25-29`; `src/commands/issue.ts:161-194`
- `$EDITOR="code --wait"` is passed as one executable name and fails. Theirs has the same defect. `src/lib/body.ts:49-58`; `linear-cli-reference/src/utils/editor.ts:7-23`; `linear-cli-reference/src/utils/editor.ts:43-53`
- Raw `api` synchronously reads fd 0 whenever stdin is non-TTY and no query source is supplied. An open but empty pipe can block indefinitely; theirs bounds implicit stdin probing. `src/commands/api.ts:81-89`; `src/lib/body.ts:41-46`; `linear-cli-reference/src/commands/api.ts:260-300`

For humans, theirs offers much more useful guided interaction: searchable team selection, optional-field prompts, editor composition, and a default-No “start now” step during issue creation. `linear-cli-reference/src/commands/issue/issue-create.ts:291-424` Its document editor seeds current content and cancels unchanged edits. `linear-cli-reference/src/commands/document/document-update.ts:238-271`

For agents, ours’ centralized guard would be better once fixed. Theirs still has commands that invoke auth/comment/start prompts without a general stdin-TTY gate. `linear-cli-reference/src/commands/auth/auth-login.ts:22-40`; `linear-cli-reference/src/commands/auth/auth-logout.ts:25-50`; `linear-cli-reference/src/commands/issue/issue-start.ts:28-57`

## 8. Docs & discoverability

Ours’ README is strong at the top level: installation, quickstart, core concepts, workflows, group overview, JSON contract, exit codes, and discovery are all presented in a logical order. `README.md:32-170`; `README.md:198-288`

The fastest human path breaks in several places:

- The README says every group has help, but invoking many bare groups yields `error: (outputHelp)` rather than useful help. `README.md:166-170`; `src/cli.ts:123-128`; `src/bin/linear.ts:18-37`
- Every help page is swollen by globals that may do nothing on that command. `src/cli.ts:102-120`
- The generated skill explicitly tells agents that every command accepts all globals, carrying the false affordance into secondary documentation. `skills/linear-sdk-cli/scripts/generate-docs.ts:142-165`
- The README claims “paged sanely,” but there is no paging in the output path. `README.md:22-25`; `src/output/format.ts:45-66`
- The repository contains a useful skill, but the npm `files` list excludes `skills/`, so a normal package installation does not actually include it. `README.md:286-288`; `package.json:30-35`

Theirs’ source repository includes both an end-user skill and a detailed contributor `AGENTS.md`. The latter should not be mistaken for a runtime agent guide—it explicitly describes repository development. `linear-cli-reference/AGENTS.md:1-14` Its skill is helpful but static and ultimately directs agents back to repeated `--help` calls. `linear-cli-reference/skills/linear-cli/SKILL.md:66-215` Its npm package likewise excludes the skill and `AGENTS.md`. `linear-cli-reference/package.json:6-12`

Theirs also has documentation drift: `docs/usage.md` still recommends `issue list --assignee`, `--unassigned`, and `--all-assignees`, while source marks those flags removed and directs users to `issue query`. `linear-cli-reference/docs/usage.md:40-54`; `linear-cli-reference/src/commands/issue/issue-mine.ts:73-83`; `linear-cli-reference/src/commands/issue/issue-mine.ts:116-123`

For a cold agent, ours is ahead because `linear commands --json` avoids help scraping. Its next improvement should be an honest manifest containing option types/choices/defaults, conflicts, output shapes, prompt behavior, and mutation/destructive metadata.

## Findings

| severity | area | what's wrong | evidence (`file:line`) | suggested fix |
|---|---|---|---|---|
| high | interactive / agent contract | `--no-input` maps to `input:false`, but `Context` checks `noInput`; TTY-backed agents still prompt. JSON/piped stdout does not disable prompting. | `src/lib/options.ts:59-72`; `src/context.ts:12-47`; `src/lib/prompt.ts:11-35` | Read the Commander property correctly; make JSON or non-TTY stdout noninteractive unless explicitly opted in; add PTY tests. |
| high | global/local options | Global `--no-color` collides with entity `--color`; label mutations can forward boolean `false` as the API colour. | `src/lib/options.ts:59-72`; `src/commands/label.ts:40-84`; `src/services/label.ts:85-128` | Use a distinct internal property/flag such as `--no-ansi`, and add parser-collision tests. |
| high | agent contract | Mutations can emit requested/success-looking state after `success:false` or missing response entities. | `src/services/notification.ts:86-125`; `src/commands/notification.ts:38-99`; `src/services/issue.ts:392-456` | Centralize mutation unwrapping; require `success === true` and expected entities before emitting success. |
| high | global/local options | `project update --team ENG` is silently ignored while sibling create can consume global `--team` as a fallback. | `src/commands/project.ts:76-138`; `src/commands/project.ts:145-191`; `src/services/project.ts:214-232` | Use repeatable singular local `--team` consistently, or reject the global flag on update. |
| high | interactive / credentials | API keys are collected through visible text input. | `src/commands/meta.ts:53-76`; `src/lib/prompt.ts:25-35` | Add a masked secret/password prompt. |
| medium | global/local options | All twelve globals are injected and advertised even when handlers ignore them; discovery therefore lies about capabilities. | `src/cli.ts:102-120`; `src/lib/introspect.ts:52-69`; `src/commands/initiative.ts:32-41`; `src/commands/api.ts:47-55` | Replace blanket injection with capability-specific option bundles and expose applicability in discovery. |
| medium | naming / auth | `auth login` declares `--key` but also advertises ignored global `--api-key`. | `src/lib/options.ts:61-71`; `src/commands/meta.ts:53-76` | Consume one canonical `--api-key`; retain `--key` only as a deprecated alias. |
| medium | JSON contract | `--json --debug` appends plaintext after the error object. | `src/output/format.ts:82-95`; `test/contract/json-envelope.test.ts:29-73` | Put debug data inside `error.detail`, or suppress it in JSON mode. |
| medium | JSON contract | Declining confirmation exits 0 with no JSON; `completion --json` emits shell code; `schema --json --output` ignores the file. | `src/commands/issue.ts:549-584`; `src/commands/completion.ts:60-71`; `src/commands/discover.ts:71-92` | Emit a cancellation receipt; omit/reject inapplicable JSON flags; compose schema format and destination independently. |
| medium | errors / discoverability | Bare command groups return `"(outputHelp)"` instead of help or an actionable missing-subcommand error. | `src/cli.ts:123-128`; `src/bin/linear.ts:18-37` | Give groups a help action or translate Commander’s help exception to normal help and exit 0. |
| medium | output | Tables ignore terminal width/Unicode display width, use generic empty states, and omit actionable IDs from several resource lists. | `src/output/table.ts:19-95`; `src/commands/comment.ts:19-23`; `src/commands/document.ts:17-21`; `src/commands/notification.ts:12-17` | Use `string-width`, terminal budgeting, contextual empty messages, and include stable ID/slug columns. |
| medium | output | `--fields` is documented for table/detail output but only affects lists; long Markdown has no rendering or pager. | `src/output/format.ts:16-62`; `src/commands/project.ts:48-72`; `src/commands/document.ts:43-60` | Implement detail projection or restrict the option; add TTY Markdown rendering and threshold paging. |
| medium | errors | Broad catches misclassify network/server failures as not-found or invalid credentials; API invariants are classified as usage errors. | `src/services/document.ts:189-201`; `src/commands/meta.ts:61-74`; `src/services/team.ts:188-196`; `src/lib/status-update.ts:41-55` | Catch only known error types/statuses; use `api`/`network` for invariant and transport failures. |
| medium | errors | Most resolution failures do not list valid options or suggest a discovery command; ambiguity candidates may be indistinguishable. | `src/lib/resolve.ts:27-67`; `src/lib/resolve.ts:94-130`; `src/lib/resolve.ts:215-260` | Add structured suggestion/context fields; show IDs, scope, and exact list commands. |
| medium | destructive safety | Document content replacement can detach inline-comment anchors without warning. | `src/commands/document.ts:100-122`; `linear-cli-reference/src/commands/document/document-update.ts:294-310` | Detect active inline comments and require an explicit `--force`. |
| medium | destructive safety | `auth logout` removes/repoints credentials without confirmation. | `src/commands/meta.ts:169-196`; `src/config.ts:321-342` | Confirm the exact workspace and resulting default; honor `--yes`. |
| medium | failure atomicity | `issue start --move/--state` mutates Linear before branch checkout, so checkout failure leaves remote state changed. | `src/services/issue.ts:480-494`; `src/commands/issue.ts:379-389`; `src/git.ts:89-98` | Preflight/perform checkout first, or return a structured partial-success receipt and rollback where possible. |
| medium | editor UX | Comment update edits an empty template; explicit `issue create --editor` is silently ignored outside a TTY. | `src/commands/comment.ts:73-86`; `src/lib/body.ts:25-57`; `src/commands/issue.ts:158-214` | Seed current content, cancel unchanged/empty edits, and fail when explicitly requested interaction is unavailable. |
| medium | stdin behavior | Raw API implicitly performs an unbounded synchronous stdin read and can wait forever on an open empty pipe. | `src/commands/api.ts:81-89`; `src/lib/body.ts:41-46` | Use bounded async probing; reserve unbounded reads for explicit `--query-file -`. |
| medium | docs / distribution | README promises sane paging and a shipped skill, but paging is absent and npm excludes the skill. | `README.md:22-25`; `README.md:286-288`; `package.json:30-35` | Correct the paging claim; include `skills/` in the package or document repository-only installation. |
| low | naming | Project `--state` versus initiative `--status`, changing label verbs, and two comment hierarchies reduce predictability. | `src/commands/project.ts:35-43`; `src/commands/initiative.ts:73-80`; `src/commands/issue.ts:308-359`; `src/commands/comment.ts:25-125` | Standardize domain nouns and use one comment/label mutation grammar. |
| low | body/editor input | Contradictory body sources are silently prioritized, and editor values containing arguments are treated as one executable. | `src/lib/body.ts:25-29`; `src/lib/body.ts:49-58` | Reject mutually exclusive sources and safely parse editor executable plus arguments. |
| low | destructive consistency | Relation removal is ungated; raw API mutations bypass all confirmation; read-all lacks a partial-success receipt. | `src/commands/issue.ts:475-520`; `src/commands/api.ts:20-68`; `src/services/notification.ts:100-112` | Gate or explicitly document unlinking/raw-API exceptions; return completed/remaining counts for bulk operations. |

## Where theirs is better than ours

- Functional options are local, so help is more truthful and unsupported flags generally fail instead of doing nothing. `linear-cli-reference/src/main.ts:127-169`
- Long-form human output is substantially better: terminal-width Markdown rendering, conditional paging, contextual empty states, relative times, and Unicode-aware widths. `linear-cli-reference/src/commands/issue/issue-view.ts:140-240`; `linear-cli-reference/src/utils/pager.ts:104-118`; `linear-cli-reference/src/utils/display.ts:1-57`
- Human interaction is richer: guided issue creation, masked API-key input, current-content editing, unchanged-edit cancellation, and document inline-comment protection. `linear-cli-reference/src/commands/issue/issue-create.ts:291-424`; `linear-cli-reference/src/commands/auth/auth-login.ts:22-40`; `linear-cli-reference/src/commands/document/document-update.ts:238-310`
- Error presentation supports separate context and remediation, and some resolution failures name valid choices or exact follow-up commands. `linear-cli-reference/src/utils/errors.ts:24-79`; `linear-cli-reference/src/utils/errors.ts:127-151`; `linear-cli-reference/src/utils/linear.ts:176-195`
- Bare groups deliberately show help, and explicit date names are easier to discover cold. `linear-cli-reference/src/commands/issue/issue.ts:23-46`; `linear-cli-reference/src/commands/issue/issue-comment.ts:7-13`; `linear-cli-reference/src/commands/project/project-create.ts:176-179`

## Where ours is better than theirs

- The intended scripting protocol is much stronger: uniform bare arrays/objects, structured stderr errors, stable fine-grained codes, and distinct exit statuses. Theirs preserves varying GraphQL connection shapes and exits 1 for every handled failure. `src/output/format.ts:1-100`; `src/lib/errors.ts:20-59`; `linear-cli-reference/AGENTS.md:26-27`; `linear-cli-reference/src/utils/errors.ts:127-151`
- `linear commands --json` and `linear schema` provide live machine discovery rather than requiring an agent to scrape a static skill and repeated help pages. `src/commands/discover.ts:18-93`; `src/lib/introspect.ts:28-69`
- Curated delete/archive operations follow one default-No confirmation policy and refuse non-TTY execution without `--yes`. Theirs silently archives issues and deletes comments, and its team-delete flow can move issues before final confirmation. `src/lib/prompt.ts:17-23`; `src/commands/issue.ts:547-584`; `linear-cli-reference/src/commands/issue/issue-archive.ts:21-49`; `linear-cli-reference/src/commands/team/team-delete.ts:72-131`
- Ours’ short flags have much better cross-command semantic consistency. `src/lib/options.ts:59-88`; `src/commands/issue.ts:161-174`
- Ours centralizes table/detail/error output and provides a case-insensitive, ordered `--fields` selector with actionable unknown-field errors; theirs duplicates output logic and has no equivalent general projection facility. `src/output/format.ts:25-100`; `src/output/table.ts:37-59`
- Ours refuses ambiguous team/user/project/label matches rather than silently choosing a candidate, which is safer for agents. `src/lib/resolve.ts:41-48`; `src/lib/resolve.ts:58-67`; `src/lib/resolve.ts:94-130`; `src/lib/resolve.ts:215-224`
