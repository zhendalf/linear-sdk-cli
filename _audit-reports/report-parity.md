## Verdict

- Neither CLI is a superset. Ours has materially broader Linear-resource coverage; theirs is deeper in issue discovery, file/VCS workflows, portfolio linkage, bulk actions, and rendered output.
- Ours’ strongest advantages are notifications, webhooks, favorites, organization details/invites, issue subscriptions, comment resolution, attachment lifecycle, cycle mutations, project archive, label hierarchy/update, reliable pagination, and uniform JSON.
- Theirs’ strongest advantages are richer issue queries, file uploads, agent sessions, initiative/project linkage, project/team deletion, private teams, document editing safeguards, bulk operations, jj support, and GitHub autolinks.
- The most serious migration hazards are semantic collisions: `-t`, `-p`, `-a`, `-n`, `-f`, `-l`, `--team`, `--all`, `--workspace`, repeated `--label`, and `--sort priority` can mean different things.
- Particularly dangerous: ours accepts `issue update --team` and `project update --team`, but neither command uses it to perform the move/reassignment that the reference performs.
- Ours’ advertised `api --operation` is inert: SDK v89 ignores the fourth argument. Multi-operation selection does not work.
- The reference also has real defects: initiative update sends invalid lowercase status enums; search-plus-milestone silently drops the milestone; `team id` prints a key, and some web/app modes ignore filters.
- Most missing Linear-native operations are technically reachable through both CLIs’ raw GraphQL commands. The meaningful gaps are the absence of safe, typed, discoverable workflows.
- `PARITY.md` is substantially stale: schema and user coverage are misstated, SDK/config architecture is outdated, cycle/comment/attachment claims are overstated, and several important gaps and semantic mismatches are missing.

Source notation below:

- `O` = `/Users/z/code/linear-sdk-cli`
- `T` = `/private/tmp/claude-501/-Users-z-code-linear-sdk-cli/fe0be235-7b2c-40e4-a9d4-af25326e73e2/scratchpad/audit/linear-cli-reference`

## 1. Capability matrix

### Issue

| Capability | Ours | Theirs | Verdict |
|---|---:|---:|---|
| “My issues” list | Yes, composed as `issue list --assignee me --state unstarted` | Yes, `issue mine`, aliased to `issue list` | `different-shape` — the literal `issue list` has radically different defaults. `O src/commands/issue.ts:80-117`; `T src/commands/issue/issue-mine.ts:27-37,124-135` |
| Broad structured query | Yes, `issue list` | Yes, `issue query` | `partial` — theirs adds multi-team/state, unassigned, project-label, milestone, date and comment-search filters; ours adds exact priority and created/updated sorts. `O src/lib/options.ts:79-98`; `T src/commands/issue/issue-query.ts:27-84` |
| Full-text search | Yes, `issue search`; also `issue list --query` | Yes, `issue query --search` | `partial` — theirs can search comments; ours supports a separate filterable relevance search and a sortable content filter. `O src/commands/issue.ts:120-154`; `O src/services/issue.ts:156-159,197-242`; `T src/commands/issue/issue-query.ts:249-290` |
| Create issue | Yes | Yes | `partial` — theirs controls default templates and can start immediately; ours has explicit editor and stdin-file handling. `O src/commands/issue.ts:157-218`; `T src/commands/issue/issue-create.ts:441-475,737-784` |
| Update issue | Yes | Yes | `partial` — theirs moves teams and replaces the full label set; ours only changes labels incrementally. `O src/commands/issue.ts:220-279`; `T src/commands/issue/issue-update.ts:26-72,245-307` |
| Assign, state, incremental labels | Dedicated subcommands plus update flags | Update flags | `parity` — different paths. `O src/commands/issue.ts:281-325`; `T src/commands/issue/issue-update.ts:29-71,250-287` |
| View details | Yes | Yes | `partial` — ours includes due date, estimate, team, timestamps and subscribers; theirs includes children, attachments, documents and threaded comments. `O src/services/issue.ts:263-323`; `T src/utils/linear.ts:211-309` |
| Browser open | `issue view --web` | `issue view --web` | `parity`. `O src/commands/issue.ts:60-75`; `T src/commands/issue/issue-view.ts:26-44` |
| Native Linear.app open | No | Yes | `theirs-only`. `O src/commands/issue.ts:55-591`; `T src/commands/issue/issue-view.ts:30-44` |
| Start work | Git checkout; optional state change | Git/jj; starts VCS and then moves state | `different-shape` — ours supports state-only/no-checkout; theirs supports jj, branch/source options and interactive selection. `O src/commands/issue.ts:361-408`; `T src/commands/issue/issue-start.ts:8-57`; `T src/utils/actions.ts:75-98` |
| Describe/commit trailer | Yes | Yes | `different-shape` — different title/trailer formats. `O src/commands/issue.ts:410-425`; `T src/commands/issue/issue-describe.ts:7-25` |
| GitHub PR | Yes | Yes | `different-shape` — same broad flags but different title/body and JSON contracts. `O src/commands/issue.ts:427-471`; `T src/commands/issue/issue-pull-request.ts:7-53` |
| Archive/unarchive/delete one | Yes | Yes | `parity`, with ours confirming archive. `O src/commands/issue.ts:547-584`; `T src/commands/issue/issue-archive.ts:21-49`; `T src/commands/issue/issue-unarchive.ts:21-49`; `T src/commands/issue/issue-delete.ts:20-58` |
| Bulk delete | No | Yes | `theirs-only`. `O src/commands/issue.ts:573-584`; `T src/commands/issue/issue-delete.ts:20-43,129-250` |
| Relations | Add/remove/list, four types | Add/delete/list, same four types | `parity`. `O src/commands/issue.ts:473-521`; `T src/commands/issue/issue-relation.ts:15-365` |
| Subscribe/unsubscribe | Yes | No | `ours-only`. `O src/commands/issue.ts:523-545`; `T src/commands/issue/issue.ts:23-46` |
| Scalar ID/title/URL | Yes | Yes | `parity`. `O src/commands/issue.ts:587-591`; `T src/commands/issue/issue-id.ts:5-20`; `T src/commands/issue/issue-title.ts:5-21`; `T src/commands/issue/issue-url.ts:5-21` |
| Branch scalar | Dedicated `issue branch` | Only within view JSON | `different-shape`. `O src/commands/issue.ts:587-591`; `T src/utils/linear.ts:211-218,313-321` |
| Issue-linked commits | No | `issue commits`, jj trailers only | `theirs-only`. `O src/commands/issue.ts:55-591`; `T src/commands/issue/issue-commits.ts:13-99` |
| Agent sessions | No curated command | List/view | `theirs-only`. `O src/commands/issue.ts:55-591`; `T src/commands/issue/issue-agent-session-list.ts:14-124`; `T src/commands/issue/issue-agent-session-view.ts:12-186` |

### Comment and attachment

| Capability | Ours | Theirs | Verdict |
|---|---:|---:|---|
| Comment add/list/update/delete | Yes, top-level and issue shorthands | Yes, under `issue comment` | `parity`. `O src/commands/comment.ts:25-103`; `O src/commands/issue.ts:327-359`; `T src/commands/issue/issue-comment.ts:7-13` |
| Reply | Dedicated `comment reply` | `issue comment add --parent` | `parity`, ours is more ergonomic. `O src/commands/comment.ts:56-71`; `T src/commands/issue/issue-comment-add.ts:18-33,148-160` |
| Resolve/unresolve | Yes | No | `ours-only`. `O src/commands/comment.ts:105-128`; `T src/commands/issue/issue-comment.ts:7-13` |
| Threaded/resolution-aware presentation | No, flattened rows | Yes | `theirs-only`. `O src/services/comment.ts:27-68`; `T src/commands/issue/issue-comment-list.ts:24-53,77-140` |
| URL attachment | `attachment create --url` | `issue link` | `parity`, different path/integration handling. `O src/commands/attachment.ts:39-58`; `T src/commands/issue/issue-link.ts:18-31,66-105` |
| Attachment list | Dedicated, paginated | Embedded first 50 in issue view | `partial`, ours is stronger. `O src/commands/attachment.ts:27-37`; `O src/services/attachment.ts:45-55`; `T src/utils/linear.ts:288-297` |
| Attachment delete | Yes | No | `ours-only`. `O src/commands/attachment.ts:60-73`; `T src/commands/issue/issue.ts:23-46` |
| Local-file sidebar upload | No | Yes, `issue attach` | `theirs-only`. `O src/commands/attachment.ts:21-74`; `T src/commands/issue/issue-attach.ts:24-37,48-107` |
| Inline comment uploads | No | Repeatable `--attach`, private/public control | `theirs-only`. `O src/commands/comment.ts:25-128`; `T src/commands/issue/issue-comment-add.ts:18-32,61-128` |
| Download images/attachments | No | Yes by default in human issue view | `theirs-only`. `O src/commands/issue.ts:598-625`; `T src/commands/issue/issue-view.ts:36-40,65-99,465-523` |

### Project and status updates

| Capability | Ours | Theirs | Verdict |
|---|---:|---:|---|
| List projects | Yes | Yes | `partial (different scope and filter semantics)` — ours’ `--state` filters broad project state; theirs’ `--status` matches a custom status name and supports explicit all-teams. `O src/commands/project.ts:31-45`; `O src/services/project.ts:49-91`; `T src/commands/project/project-list.ts:61-68,105-153` |
| View project | Yes | Yes | `partial` — ours reports more related metadata; theirs adds web/app/pager and slug resolution. `O src/commands/project.ts:49-72`; `O src/services/project.ts:118-149`; `T src/commands/project/project-view.ts:78-100` |
| Create project | Yes | Yes | `partial` — shared core fields; theirs additionally links the new project to an initiative. `O src/commands/project.ts:76-143`; `T src/commands/project/project-create.ts:153-189,425-483` |
| Update project | Yes | Yes | `partial` — ours updates content, priority, members, icon and color; theirs resolves slugs. `O src/commands/project.ts:145-196`; `O src/services/project.ts:195-236`; `T src/commands/project/project-update.ts:55-83`; `T src/utils/linear.ts:1216-1242` |
| Archive project | Yes | No | `ours-only`. `O src/commands/project.ts:198-210`; `T src/commands/project/project.ts:14-18` |
| Trash/delete project | No curated route | Yes | `theirs-only`. `O src/commands/project.ts:198-231`; `T src/commands/project/project-delete.ts:23-67` |
| Project milestones convenience | Yes | Via milestone group | `parity`, different path. `O src/commands/project.ts:213-229`; `T src/commands/milestone/milestone-list.ts:34-53` |
| Project update create/list | Yes | Yes | `partial` — ours requires a body; theirs permits health-only. `O src/commands/project-update.ts:17-46`; `O src/lib/status-update.ts:58-79`; `T src/commands/project-update/project-update-create.ts:54-61,149-170` |
| Initiative update create/list | Yes | Yes | `partial` for the same body restriction. `O src/commands/initiative-update.ts:17-46`; `T src/commands/initiative-update/initiative-update-create.ts:93-100,187-202,307-321` |

### Team

| Capability | Ours | Theirs | Verdict |
|---|---:|---:|---|
| List | Yes | Yes | `parity`, theirs adds web/app while ours has controlled pagination. `O src/commands/team.ts:49-59`; `T src/commands/team/team-list.ts:42-105` |
| View | Yes | No | `ours-only`. `O src/commands/team.ts:61-81`; `T src/commands/team/team.ts:17-23` |
| Create | Yes | Yes | `partial` — theirs supports private-team creation. `O src/commands/team.ts:135-156`; `T src/commands/team/team-create.ts:10-18,104-120` |
| Update | Yes | No | `ours-only`. `O src/commands/team.ts:158-177`; `T src/commands/team/team.ts:17-23` |
| Delete/migrate issues | No | Yes | `theirs-only`. `O src/commands/team.ts:46-178`; `T src/commands/team/team-delete.ts:28-35,72-218` |
| Members | Yes | Yes | `parity`, but `--all` means different things. `O src/commands/team.ts:84-100`; `T src/commands/team/team-members.ts:8-37` |
| Workflow states | `team states` and `state list` | `team states` | `parity`. `O src/commands/team.ts:102-111`; `T src/commands/team/team-states.ts:10-32` |
| Labels | `team labels` | `label list --team` | `parity`, different path/scope. `O src/commands/team.ts:113-122`; `T src/commands/label/label-list.ts:37-69` |
| Cycles | `team cycles` / `cycle list` | `cycle list --team` | `parity`, different path. `O src/commands/team.ts:124-133`; `T src/commands/cycle/cycle-list.ts:54-84` |
| GitHub autolinks | No | Yes | `theirs-only`. `O src/commands/team.ts:46-178`; `T src/commands/team/team-autolinks.ts:8-39` |
| Team ID/key getter | View returns UUID and key | `team id` prints the key | `different-shape` — their command description is misleading. `O src/commands/team.ts:63-80`; `T src/commands/team/team-id.ts:5-15` |

### Cycle and milestone

| Capability | Ours | Theirs | Verdict |
|---|---:|---:|---|
| Cycle list | Yes, paginated | Yes, single request | `parity`. `O src/commands/cycle.ts:26-36`; `T src/commands/cycle/cycle-list.ts:15-35,54-88` |
| Cycle view | Yes | Yes | `partial` — theirs includes issue summaries; ours reports SDK progress and accepts UUID. `O src/commands/cycle.ts:38-47`; `O src/services/cycle.ts:54-80`; `T src/commands/cycle/cycle-view.ts:49-73,117-159` |
| Current cycle | `cycle current` or `view current/active` | `cycle view active` | `parity`, different path. `O src/commands/cycle.ts:49-57`; `T src/utils/linear.ts:1738-1743` |
| Cycle create/update | Yes | No | `ours-only`. `O src/commands/cycle.ts:60-107`; `T src/commands/cycle/cycle.ts:5-12` |
| Cycle delete/archive | No | No | `parity` as absent. Ours therefore does not have “full cycle CRUD.” `O src/commands/cycle.ts:23-108`; `T src/commands/cycle/cycle.ts:5-12` |
| Milestone list/view/create/delete | Yes | Yes | `parity`, with different arguments and pagination. `O src/commands/milestone.ts:30-94,123-136`; `T src/commands/milestone/milestone-list.ts:34-65`; `T src/commands/milestone/milestone-view.ts:50-109`; `T src/commands/milestone/milestone-create.ts:26-49`; `T src/commands/milestone/milestone-delete.ts:18-55` |
| Milestone update basic fields | Yes | Yes | `parity`. `O src/commands/milestone.ts:96-121`; `T src/commands/milestone/milestone-update.ts:27-55` |
| Milestone reparent/sort | No | Yes | `theirs-only`. `O src/commands/milestone.ts:96-121`; `T src/commands/milestone/milestone-update.ts:33-59` |

### Label

| Capability | Ours | Theirs | Verdict |
|---|---:|---:|---|
| List labels | Yes | Yes | `partial (dangerous scope semantics)` — ours with a team returns team-owned labels; theirs’ team scope also includes workspace labels and has explicit workspace/all scope. `O src/commands/label.ts:26-36`; `O src/services/label.ts:42-69`; `T src/commands/label/label-list.ts:37-72` |
| Create team/workspace label | Yes | Yes | `partial` — defaults differ when a team is configured. `O src/commands/label.ts:38-68`; `T src/commands/label/label-create.ts:43-65,159-179` |
| Create sub-label | Yes, `--parent` | No | `ours-only`. `O src/commands/label.ts:46-61`; `T src/commands/label/label-create.ts:43-49,168-173` |
| Update | Yes | No | `ours-only`. `O src/commands/label.ts:70-89`; `T src/commands/label/label.ts:6-14` |
| Delete | Yes | Yes | `partial` — team disambiguation differs. `O src/commands/label.ts:91-104`; `O src/services/label.ts:134-156`; `T src/commands/label/label-delete.ts:92-153` |

### Document

| Capability | Ours | Theirs | Verdict |
|---|---:|---:|---|
| List/filter by project or issue | Yes, paginated | Yes, first request only | `parity`, ours is stronger on pagination. `O src/commands/document.ts:26-41`; `T src/commands/document/document-list.ts:41-84` |
| View | Yes | Yes | `partial` — theirs adds raw/web/pager/download modes and full comments in JSON. `O src/commands/document.ts:43-61`; `T src/commands/document/document-view.ts:127-148` |
| Create | Requires project, issue or team container | Can create a workspace document without a container | `partial`. `O src/commands/document.ts:63-98`; `O src/services/document.ts:118-157`; `T src/commands/document/document-create.ts:36-45,153-169` |
| Icon | No | Create/update `--icon` | `theirs-only`. `O src/commands/document.ts:63-123`; `T src/commands/document/document-create.ts:39-45`; `T src/commands/document/document-update.ts:176-186` |
| Update title/content | Yes | Yes | `parity`. `O src/commands/document.ts:100-123`; `T src/commands/document/document-update.ts:176-187` |
| Repoint project | No | Yes | `theirs-only`. `O src/commands/document.ts:100-123`; `T src/commands/document/document-update.ts:183-214` |
| Edit current body in editor | No | `--edit` | `theirs-only`. `O src/commands/document.ts:100-123`; `T src/commands/document/document-update.ts:185-186,238-271` |
| Protect active inline-comment anchors | No | Refuses content replacement unless `--force` | `theirs-only`. `O src/commands/document.ts:100-123`; `T src/commands/document/document-update.ts:294-309` |
| Delete one | Yes | Yes | `parity`. `O src/commands/document.ts:125-139`; `T src/commands/document/document-delete.ts:19-54` |
| Bulk delete | No | Yes | `theirs-only`. `O src/commands/document.ts:125-139`; `T src/commands/document/document-delete.ts:23-39` |

### Initiative and roadmap

| Capability | Ours | Theirs | Verdict |
|---|---:|---:|---|
| Initiative list | All non-archived statuses, paginated | Active only by default; status/owner/archive filters, single request | `partial`. `O src/commands/initiative.ts:32-42`; `O src/services/initiative.ts:49-80`; `T src/commands/initiative/initiative-list.ts:73-84,117-164` |
| Initiative view | Priority, labels, owner, health | Linked projects plus web/app/pager | `partial`. `O src/commands/initiative.ts:44-65`; `T src/commands/initiative/initiative-view.ts:67-102,125-215` |
| Create | Priority/labels, five valid statuses, description file | Icon/color/wizard, only three statuses | `partial`. `O src/commands/initiative.ts:68-103`; `T src/commands/initiative/initiative-create.ts:26-56,197-205` |
| Update | Valid statuses, priority/label replacement | Icon/color/interactive, but broken status casing | `partial`. `O src/commands/initiative.ts:105-138`; `O src/services/initiative.ts:228-235`; `T src/commands/initiative/initiative-update.ts:19-29,158-166`; `T graphql/schema.graphql:11738-11744` |
| Archive/delete one | Yes | Yes | `parity`. `O src/commands/initiative.ts:140-169`; `T src/commands/initiative/initiative-archive.ts:21-52`; `T src/commands/initiative/initiative-delete.ts:21-29,135-153` |
| Bulk archive/delete | No | Yes | `theirs-only`. `O src/commands/initiative.ts:140-169`; `T src/commands/initiative/initiative-archive.ts:21-29`; `T src/commands/initiative/initiative-delete.ts:21-29` |
| Unarchive | No | Yes | `theirs-only`. `O src/commands/initiative.ts:140-169`; `T src/commands/initiative/initiative-unarchive.ts:10-38,80-113` |
| Link/unlink project | No | Yes | `theirs-only`. `O src/commands/initiative.ts:26-170`; `T src/commands/initiative/initiative-add-project.ts:169-223`; `T src/commands/initiative/initiative-remove-project.ts:184-267` |
| Legacy roadmap CRUD | Full list/view/create/update/delete | No curated group | `ours-only`, but low strategic value because the API deprecates roadmaps for initiatives. `O src/commands/roadmap.ts:19-130`; `T src/main.ts:111-125`; `T graphql/schema.graphql:31372-31380` |

### User, workflow state, organization, notification, webhook, favorite

| Capability | Ours | Theirs | Verdict |
|---|---:|---:|---|
| User list | Yes, `--include-disabled` | Yes, `--all` | `parity`, different flag spelling. `O src/commands/user.ts:24-35`; `T src/commands/user/user-list.ts:8-47` |
| User view/me | Yes | No | `ours-only`. `O src/commands/user.ts:37-57`; `T src/commands/user/user.ts:3-11` |
| Workflow-state list | `state list` and `team states` | `team states` | `parity`, different path. `O src/commands/state.ts:22-35`; `T src/commands/team/team-states.ts:10-32` |
| Workflow-state view | Yes | No | `ours-only`. `O src/commands/state.ts:37-56`; `T src/commands/team/team.ts:17-23` |
| Organization members | `organization members` / `user list` | `user list` | `parity`, different path. `O src/commands/organization.ts:58-67`; `T src/commands/user/user-list.ts:8-47` |
| Organization metadata/invites | Yes | No | `ours-only`. `O src/commands/organization.ts:28-78`; `T src/main.ts:111-125` |
| Notifications | List/read/unread/read-all/archive/snooze | No | `ours-only`. `O src/commands/notification.ts:19-100`; `T src/main.ts:111-125` |
| Webhooks | Full CRUD | No | `ours-only`. `O src/commands/webhook.ts:30-145`; `T src/main.ts:111-125` |
| Favorites | List/add/remove | No | `ours-only`. `O src/commands/favorite.ts:22-71`; `T src/main.ts:111-125` |

### Auth, config, API, schema, discovery

| Capability | Ours | Theirs | Verdict |
|---|---:|---:|---|
| Multi-workspace login/list/default/token/logout | Yes | Yes | `partial` — command names match but validation, prompting, JSON, selection and confirmation differ. `O src/commands/meta.ts:51-197`; `T src/commands/auth/auth.ts:1-22` |
| Who am I | Top-level `whoami` | `auth whoami` | `parity`, different path. `O src/commands/meta.ts:22-49`; `T src/commands/auth/auth-whoami.ts:25-50` |
| `auth status` | Local key-source/readback | Live viewer/org validation | `different-shape`. `O src/commands/meta.ts:145-167`; `T src/commands/auth/auth-status.ts:26-64` |
| Resolved config/provenance | `config` | No | `ours-only`. `O src/commands/meta.ts:199-235`; `T src/commands/config.ts:29-196` |
| Generate project config | No command | Interactive/noninteractive `config` writer | `theirs-only`. `O src/commands/meta.ts:199-235`; `T src/commands/config.ts:52-80,141-192` |
| Project config discovery | `.linear.toml` ancestor walk; secrets excluded | Several cwd/git-root locations; accepts `api_key` | `different-shape`. `O src/config.ts:4-13,141-177,179-260`; `T src/config.ts:40-85,111-135,181-199` |
| Raw GraphQL | Yes | Yes | `partial` — file and output features differ; ours’ operation selection is broken. `O src/commands/api.ts:20-169`; `T src/commands/api.ts:22-188` |
| Schema SDL/introspection | Yes | Yes | `partial` — core parity, but ours ignores `--output` when `--json` is set. `O src/commands/discover.ts:55-93`; `T src/commands/schema.ts:13-42` |
| Machine-readable command discovery | `commands` | No | `ours-only`. `O src/commands/discover.ts:18-53`; `T src/main.ts:111-125` |
| Shell completion | Bash/zsh/fish, top-level only | No | `ours-only`, but shallow. `O src/commands/completion.ts:23-72`; `T src/main.ts:111-125` |

## 2. Real gaps in OURS

Both CLIs can execute arbitrary GraphQL. Therefore, “cannot at all” has two meanings:

- Literal gaps outside GraphQL: file-transfer workflow, jj/local commit discovery, GitHub autolinks, rich rendering/download/app launch.
- First-class gaps: technically possible through handwritten GraphQL, but absent as safe, typed CLI capabilities. Raw `api` is not equivalent for normal users or automation.

| Gap | Why users want it | SDK v89 feasibility | Priority / rough effort |
|---|---|---|---|
| Issue team reassignment and full label replacement | Correct misfiled issues and make label automation idempotent | Direct: `IssueUpdateInput.teamId`, `labelIds`, `addedLabelIds`, `removedLabelIds`. `node_modules/@linear/sdk/dist/index-DHA7xCPn.d.mts:11473-11537` | **High, small–medium** — destination-team state/cycle/label validation is the main work |
| Rich issue-query facets | Routine triage needs unassigned, multi-state/team, project-label, milestone and created/updated bounds | `IssueFilter` exposes these relationships/date fields. `node_modules/@linear/sdk/dist/index-DHA7xCPn.d.mts:9778-9818,9860-9918` | **High, medium** |
| Search comments | Discussion text often contains the only useful search term | SDK `searchIssues` supports `includeComments`. `node_modules/@linear/sdk/dist/index.d.mts:27343-27351` | **High, small** |
| File uploads for attachments/comments | Logs, screenshots and artifacts are core terminal/agent inputs | SDK has `fileUpload`, upload headers/publicity, attachment creation and `commentBody`. `node_modules/@linear/sdk/dist/index.d.mts:28129-28138`; `index-DHA7xCPn.d.mts:2409-2433,61638-61657` | **High, medium** — signed mutation plus HTTP PUT/MIME handling |
| Initiative/project linking | Portfolio workflows need projects attached to strategy | Direct create/delete/update relation methods. `node_modules/@linear/sdk/dist/index.d.mts:28303-28323` | **High, small–medium** |
| Project slug resolution and all-team/custom-status listing | URL-derived slugs are common, and configured-team narrowing currently hides projects | SDK queries are sufficient; requires resolver/filter work, not new API surface. Current limitations: `O src/lib/resolve.ts:215-224`; `O src/services/project.ts:49-64` | **High, small** |
| Health-only status updates | A health change should not require invented prose | SDK inputs make body optional. `node_modules/@linear/sdk/dist/index-BtsNqLmC.d.cts:8263-8275,18856-18868` | **Medium-high, trivial** |
| Rich issue view | Child issues, attachments, documents and threaded comments provide a complete work context | Typed `Issue.children`, comments, documents and attachments exist; comment types expose parent/resolved fields. `node_modules/@linear/sdk/dist/index.d.mts:7481-7488,3007-3047` | **Medium-high, medium** |
| Agent-session list/view | Inspect coding-agent status, summaries, links and activity | SDK exposes sessions, status and activities. `node_modules/@linear/sdk/dist/index.d.mts:488-569,26531-26543` | **Medium, medium** |
| Initiative filters and unarchive | Large portfolios require owner/status/archive navigation and recovery | SDK directly exposes unarchive. `node_modules/@linear/sdk/dist/index.d.mts:28325-28330` | **Medium, small–medium** |
| Project trash/delete | Archive and trash are distinct lifecycle operations | Direct `deleteProject`. `node_modules/@linear/sdk/dist/index.d.mts:29181-29186` | **Medium, small** |
| Document icon/project move/editor safety | Preserve document metadata and avoid detaching inline anchors | SDK create/update inputs include icon, color and project ID. `node_modules/@linear/sdk/dist/index-BtsNqLmC.d.cts:5456-5486,5731-5763` | **Medium, medium** |
| Private-team creation and safe team deletion | Visibility at creation and controlled consolidation | `TeamCreateInput.private` and `deleteTeam` are exposed. `node_modules/@linear/sdk/dist/index-BtsNqLmC.d.cts:23297-23304`; `node_modules/@linear/sdk/dist/index.d.mts:29661-29666` | **Medium-low: private small; deletion/migration medium** |
| Bulk issue/document/initiative operations | Generated ID sets need one review, structured results and partial-failure handling | Existing single mutations can be looped; no SDK blocker | **Medium, medium** |
| Default-template control | Prevent issue creation from silently diverging from team conventions | `IssueCreateInput.templateId/useDefaultTemplate` exists. `node_modules/@linear/sdk/dist/index-DHA7xCPn.d.mts:9657-9662` | **Medium, small** |
| Milestone reparent/sort | Roadmap maintenance needs moving and ordering milestones | SDK update input directly exposes both. `node_modules/@linear/sdk/dist/index-BtsNqLmC.d.cts:17993-18005` | **Low-medium, small** |
| jj commits/start and GitHub autolinks | Useful for jj users and repository onboarding | Not SDK work; requires a VCS abstraction and `gh` integration. `T src/commands/issue/issue-commits.ts:13-99`; `T src/commands/team/team-autolinks.ts:8-39` | **Low-medium, medium-large for jj; small for autolinks** |

Two correctness fixes belong beside these gaps:

- `api --operation` must be implemented through direct HTTP/AST selection or removed. Ours passes a fourth argument (`O src/commands/api.ts:59-61,135-138`), while SDK v89 accepts three and serializes only query/variables (`node_modules/@linear/sdk/dist/index.d.mts:117-125`; `node_modules/@linear/sdk/dist/index.mjs:1348-1353`).
- `schema --json --output` must write the requested file; ours returns before checking `opts.output` (`O src/commands/discover.ts:79-88`).

## 3. Real gaps in THEIRS — our advantages

| Gap in theirs | User value | Likely effort / priority |
|---|---|---|
| Notifications, webhooks, favorites and organization metadata/invites | Large missing operational surface, especially webhook automation and inbox management. `O src/commands/notification.ts:19-100`; `O src/commands/webhook.ts:30-145`; `O src/commands/favorite.ts:22-71`; `O src/commands/organization.ts:28-78`; absent from `T src/main.ts:111-125` | **High, medium-large** across several GraphQL groups |
| Uniform JSON plus common pagination/field controls | Reliable agent and shell composition across reads and mutations. `O src/lib/options.ts:59-72`; `O src/cli.ts:102-120` | **High, architectural medium-large** |
| Cycle create/update | Manage sprint boundaries without raw mutations. `O src/commands/cycle.ts:60-107`; reference only list/view at `T src/commands/cycle/cycle.ts:5-12` | **High, small–medium** |
| Broad project update and archive | Ours manages content, priority, members, icon/color and safe archive. `O src/commands/project.ts:145-210`; theirs stops at teams/labels and only has delete. `T src/commands/project/project-update.ts:55-83` | **High, medium** |
| Correct initiative statuses plus priority/labels | Their update status is broken and their create subset is incomplete. `O src/services/initiative.ts:16-31,228-235`; `T src/commands/initiative/initiative-update.ts:11-29`; `T graphql/schema.graphql:11738-11744` | **High, small** |
| Reliable pagination | Several reference lists issue only one connection request. `O src/services/project.ts:67-91`; `O src/services/initiative.ts:59-80`; `T src/commands/initiative/initiative-list.ts:149-164` | **High, medium shared helper** |
| Comment resolve/unresolve and issue subscribe/unsubscribe | Completes review-thread and notification lifecycle. `O src/commands/comment.ts:105-128`; `O src/commands/issue.ts:523-545` | **Medium, small** |
| Attachment paginated list/delete | Full attachment lifecycle rather than only create/view-first-50. `O src/commands/attachment.ts:27-73`; `T src/utils/linear.ts:288-297` | **Medium, small** |
| Team view/update | Inspect actual UUID/settings and maintain teams. `O src/commands/team.ts:61-81,158-177`; absent at `T src/commands/team/team.ts:17-23` | **Medium, small** |
| Label update and hierarchy | Maintain taxonomy and sub-labels. `O src/commands/label.ts:38-89`; `T src/commands/label/label.ts:6-14` | **Medium, small** |
| User view/me and workflow-state view | Direct inspection beyond list output. `O src/commands/user.ts:37-57`; `O src/commands/state.ts:37-56` | **Medium-low, small** |
| Priority filter and updated/created issue sorts | Useful triage dimensions missing from their query choices. `O src/lib/options.ts:85,95-98`; `T src/commands/issue/issue-query.ts:27-84` | **Medium, small** |
| Resolved-config readback, runtime command discovery and completion | Better diagnostics and agent discoverability. `O src/commands/meta.ts:199-235`; `O src/commands/discover.ts:18-53`; `O src/commands/completion.ts:23-72` | **Medium, small–medium** |
| Legacy roadmap CRUD | Genuine breadth, though strategically deprecated. `O src/commands/roadmap.ts:19-130`; absent at `T src/main.ts:111-125` | **Low** |

## 4. Flag-level parity

### Global baseline

Ours injects the following into every command:

`--json --no-color --api-key --workspace -t/--team -n/--limit --all -f/--fields -y/--yes -q/--quiet --no-input --debug`

`O src/lib/options.ts:59-72`; injection at `O src/cli.ts:102-120`.

Theirs injects only `--workspace`, with special shadowing for commands that own that spelling. `T src/main.ts:127-169`.

This makes ours more uniform, but also means irrelevant options are often accepted. In particular, inherited `--team`, `--limit`, `--all` and `--yes` must not be assumed to affect every leaf.

### `issue list` / `issue query`

Correct mappings:

- Ours `issue list` ↔ theirs `issue query` for broad structured querying.
- Ours `issue list --assignee me --state unstarted` ↔ theirs `issue mine`/`issue list`.
- Ours `issue search <text>` ↔ theirs `issue query --search`.

| Option/behavior | Ours | Theirs | Finding |
|---|---|---|---|
| Literal `issue list` default | Configured team; all states/assignees | Alias of `mine`; self + unstarted | **Dangerous:** radically different result set. `O src/services/issue.ts:120-134`; `T src/commands/issue/issue-mine.ts:27-37,124-135` |
| `--state` | One exact name or type | Repeatable types only | Ours has names; theirs has multi-state OR. `O src/services/issue.ts:129-134`; `T src/commands/issue/issue-query.ts:38-44` |
| `--all-states` | Omit state | Explicit, already default in `query` | Reachable by omission here. |
| `--assignee` | `-a`; `me/@me`, email, exact name, UUID | Long-only in query; `self/@me`, email/name, partial fallback | Sentinel and ambiguity differ. `O src/lib/resolve.ts:51-67`; `T src/utils/linear.ts:1304-1362` |
| `--unassigned` | Missing | `-U/--unassigned` | Theirs-only. `T src/commands/issue/issue-query.ts:45-47`; `T src/utils/linear.ts:834-843` |
| `--team` | One team | Repeatable teams | Theirs can query an arbitrary team subset; ours supports one or all. `O src/lib/options.ts:65,87`; `T src/commands/issue/issue-query.ts:32-37` |
| `--all-teams` | Yes | Yes | Parity. |
| `--project` | Name/UUID | Name/slug | Different identifier forms. `O src/lib/resolve.ts:215-224`; `T src/utils/linear.ts:1184-1213` |
| `--project-label` | Missing | Yes | Theirs-only. `T src/commands/issue/issue-query.ts:54-58` |
| `--milestone` | Missing from list/search filters | Yes with `--project` | Theirs-only for non-search queries. In search mode it is resolved but omitted from the request: `T src/commands/issue/issue-query.ts:235-238,259-273,292-308`. |
| `--cycle` | UUID, number, `current`/`active`; no names | Name, number, `active`; no UUID | `--cycle current` fails there; a cycle name fails here. `O src/lib/resolve.ts:227-244`; `T src/utils/linear.ts:1710-1754` |
| Repeated `--label` | OR: one label whose name is in the set | AND: one `some` condition per label | **Dangerous:** repeating broadens ours but narrows theirs. `O src/services/issue.ts:139-141`; `T src/utils/linear.ts:861-872` |
| `--priority` filter | Yes | No | Ours-only. `O src/lib/options.ts:85`; `T src/commands/issue/issue-query.ts:27-84` |
| Text option | `--query`, or dedicated `search` | `--search` | `--query` is not a direct semantic alias; ours remains sortable while their search is relevance-only. |
| `--search-comments` | No | Yes | Theirs-only. `T src/commands/issue/issue-query.ts:30-31,259-273` |
| `--sort priority` | Priority descending only | Workflow state, then priority, then manual | **Dangerous same spelling.** `O src/services/issue.ts:167-176`; `T src/utils/linear.ts:887-907` |
| Other sort choices | `updated`, `created` | `manual` | Partial in both directions. |
| Dates | No | `--created-after`, `--updated-after` | Theirs-only lower bounds, not full ranges. `T src/commands/issue/issue-query.ts:74-81` |
| `--include-archived` | List and search | Query/search, not mine | Broad-query parity. |
| Limit | Positive integer; `--all` for unlimited | `--limit 0` means unlimited | **Dangerous:** `--limit 0` is rejected here. `O src/lib/options.ts:39-49,66-67`; `T src/commands/issue/issue-query.ts:66-73` |
| JSON | Global bare array | Query returns connection/object envelope; mine has no JSON | **Dangerous script-shape difference.** `O src/output/format.ts:45-49`; `T src/commands/issue/issue-query.ts:277-279,312-314` |
| `-a` on literal list | Assignee | Open Linear.app because list aliases mine | **Dangerous short-flag collision.** `O src/lib/options.ts:82`; `T src/commands/issue/issue-mine.ts:27-29,85-86` |
| Pager/web/app | No list-page shortcut | Pager; mine has web/app | Theirs-only UX. Web/app returns before applying filters, and opener uses configured team. `T src/commands/issue/issue-mine.ts:85-114`; `T src/utils/actions.ts:52-72` |
| `--fields` | Yes | No | Ours-only. |

### `issue create`

Shared long-form capabilities: title, description/file, assignee, priority, estimate, labels, team, project, state, milestone, cycle, parent and due date. `O src/commands/issue.ts:158-174`; `T src/commands/issue/issue-create.ts:441-474`.

| Option/semantic | Difference |
|---|---|
| `-t` | **Ours = team; theirs = title.** `O src/lib/options.ts:65`; `T src/commands/issue/issue-create.ts:474` |
| `-p` | **Ours = project; theirs = priority.** Ours uses `-P` for priority. `O src/commands/issue.ts:167-170`; `T src/commands/issue/issue-create.ts:450-455` |
| Priority range | Help says 0–4 here, 1–4 there, but neither validates bounds. Ours also truncates with `parseInt`; theirs uses `Number`. `O src/lib/options.ts:33-36`; `T src/commands/issue/issue-create.ts:450-456` |
| Due date | `--due` here; `--due-date` there. Naming-only parity. |
| Self assignee | `me` here; `self` there; both accept `@me`. |
| Labels | Ours repeats or splits commas; theirs treats each repeat literally. |
| Cycle | Ours UUID/number/current/active; theirs name/number/active. |
| Team/project identifiers | Ours accepts broader team forms and project name/UUID; theirs primarily team key and project name/slug. |
| Body sources | Ours silently prefers inline description over file; theirs rejects both together. Ours supports `--description-file -`. `O src/lib/body.ts:25-44`; `T src/commands/issue/issue-create.ts:498-512` |
| Editor/interactive | Ours has explicit `--editor`; theirs has a richer interactive form and field selection. `O src/commands/issue.ts:164,190-194`; `T src/commands/issue/issue-create.ts:231-439,515-610` |
| Prompt suppression | Global `--no-input` here; `--no-interactive` there. |
| Start after create | Theirs `--start`; ours composes a second `issue start --move`. Convenience gap only. |
| Templates | Theirs `--no-use-default-template`; ours sends no template control. `T src/commands/issue/issue-create.ts:472,737-752`; `O src/services/issue.ts:348-365` |
| Parent inheritance | Theirs inherits the parent’s project when project is omitted; ours only sends `parentId`. `T src/commands/issue/issue-create.ts:714-751`; `O src/services/issue.ts:357-365` |
| JSON | Ours global structured JSON; theirs create has no JSON flag. |

### `issue update`

Shared fields: title, body/file, assignee/unassign, priority, estimate, project, state, milestone, cycle/clear-cycle, parent, due date and incremental labels. `O src/commands/issue.ts:222-240`; `T src/commands/issue/issue-update.ts:26-72`.

| Option/semantic | Difference |
|---|---|
| `-t`, `-p`, `-P` | Same dangerous collisions as create. |
| `--team` | **Most dangerous mismatch:** theirs moves the issue; ours inherits and accepts the flag but never passes it into `updateIssue`. `O src/commands/issue.ts:251-274`; `T src/commands/issue/issue-update.ts:154-180,240-287` |
| `--label` | Theirs replaces the full set; ours has no replacement flag, only add/remove. `O src/commands/issue.ts:237-240`; `T src/commands/issue/issue-update.ts:48-62,109-123` |
| Body conflicts | Ours silently prefers inline text; theirs errors. |
| Empty update | Ours errors. Theirs always writes a derived `teamId`, so a nominally empty update still performs a team-field mutation. `O src/services/issue.ts:428-430`; `T src/commands/issue/issue-update.ts:154-167,245-278` |
| JSON | Ours supports it globally; theirs does not. |
| Due, assignee, cycle, number parsing | Same semantic differences as create. |

### `issue view`

| Option/behavior | Ours | Theirs |
|---|---|---|
| Browser | `--web` | `-w/--web` |
| App | Missing | `-a/--app` |
| Comments | `--comments`, off by default, fixed at 10 | On by default, fixed at 50; `--no-comments` |
| Resolved threads | Not represented | Hidden by default; `--show-resolved-threads` |
| Pager | None | `--no-pager` |
| JSON | Flattened normalized object | Raw nested GraphQL object with comments by default |
| Downloads | None | Downloads markdown images and attachments unless `--no-download` |
| Fields | Due/estimate/team/timestamps/subscribers | Children/attachments/documents/threaded comments |

Evidence: `O src/commands/issue.ts:58-77,598-625`; `O src/services/issue.ts:263-323`; `T src/commands/issue/issue-view.ts:26-103`; `T src/utils/linear.ts:211-309`.

### `project create` / `project update`

| Capability/flag | Comparison |
|---|---|
| Name | Both `--name`; theirs adds `-n`. **Ours’ `-n` is global result limit.** `O src/lib/options.ts:65-67`; `T src/commands/project/project-create.ts:153-155` |
| Description file | Both support it; theirs adds `-f`. **Ours’ `-f` is output fields.** `O src/lib/options.ts:67-69`; `T src/commands/project/project-create.ts:156-165` |
| Content/file | Create parity. Update is ours-only. `O src/commands/project.ts:84-85,153-154`; `T src/commands/project/project-create.ts:164-165`; `T src/commands/project/project-update.ts:55-83` |
| Teams | Ours `--teams` plus inherited default `--team`; theirs repeatable `--team`. |
| Update `--team` | **Dangerous:** theirs replaces team membership; ours accepts inherited `--team` but requires `--teams` for the update payload. `O src/commands/project.ts:155,177-191`; `T src/commands/project/project-update.ts:74-78,178-189` |
| Lead | Both `--lead`. **Theirs `-l=lead`; ours local `-l=label`.** `O src/commands/project.ts:93`; `T src/commands/project/project-create.ts:171` |
| State/status | Ours `--state` resolves custom name, type or UUID; theirs `--status` accepts six fixed types and chooses the first matching organization status. `O src/services/project.ts:338-353`; `T src/commands/project/project-create.ts:172-175,367-397` |
| Dates | Ours `--start/--target`; theirs `--start-date/--target-date`. |
| Priority on create | Ours numeric 0–4; theirs words `none|urgent|high|medium|low`. **Same long flag, different value language.** `O src/services/project.ts:305-312`; `T src/commands/project/project-create.ts:110-125,178` |
| Priority on update | Ours only. |
| Labels | Both replace the full set; ours repeat/comma, theirs repeated only. |
| Members | Create parity; update ours-only. |
| Icon/color | Create parity; update ours-only. |
| Initiative | Theirs-only `--initiative`, implemented as a second mutation that can fail after project creation. `T src/commands/project/project-create.ts:187,459-483` |
| Interactive | Ours prompts only for missing name; theirs has a fuller wizard. |
| Identifier | Ours update resolves UUID/name; theirs also accepts slug. |
| JSON | Ours create/update globally; theirs create has wrapper JSON but update has none. |

Primary option sources: `O src/commands/project.ts:76-196`; `T src/commands/project/project-create.ts:153-189`; `T src/commands/project/project-update.ts:55-83`.

### Team

| Command/option | Comparison |
|---|---|
| `team create` | Shared name/key/description; theirs adds `--private`. Their `-n=name`; ours `-n=limit`. `O src/commands/team.ts:135-156`; `T src/commands/team/team-create.ts:10-20` |
| `team list` | Theirs adds web/app; ours adds global pagination/fields/JSON. |
| `team members --all` | **Ours = exhaust pagination; theirs = include inactive.** Ours uses `--include-disabled` for inactive users. `O src/commands/team.ts:84-100`; `T src/commands/team/team-members.ts:8-37` |
| `team states` | Capability parity; ours has global JSON/limit/fields. |
| `team view` / `update` | Ours-only. |
| `team delete` | Theirs-only, including `--move-issues`, `--yes`, hidden `--force`. |
| `team id` | Their command prints key, not UUID; ours view exposes both. |
| `team autolinks` | Theirs-only, executes `gh api`. |
| `team labels/cycles` | Ours-only paths but parity through their label/cycle groups. |

### Document

| Command/option | Comparison |
|---|---|
| `-t` | **Ours = inherited team; theirs = title** on create/update. |
| `-f` | **Ours = fields; theirs = content-file.** |
| List | Same project/issue filters; ours paginates, theirs takes one connection page. |
| Create content | Ours explicit text/file with `-` stdin; theirs also auto-reads piped stdin or opens an editor. |
| Container | Ours enforces exactly one project/issue/team; theirs allows a workspace document with none. |
| Icon | Theirs-only. |
| Update project | Theirs-only. |
| Update editor | Theirs-only `-e/--edit`. |
| `--force` | Theirs refuses content replacement around active inline comments unless forced; ours has no check. |
| View | Theirs adds `--raw`, `--web`, `--json`, `--no-download`, `--no-pager`; ours only global output flags. |
| Delete | Theirs adds `--bulk`, `--bulk-file`, `--bulk-stdin`; both support `--yes` through different scopes. |

Evidence: `O src/commands/document.ts:23-139`; `T src/commands/document/document-create.ts:36-169`; `T src/commands/document/document-update.ts:176-309`; `T src/commands/document/document-view.ts:127-148`; `T src/commands/document/document-delete.ts:19-54`.

### Initiative

| Command/option | Comparison |
|---|---|
| List default | **Ours = all non-archived statuses; theirs = Active only.** |
| List filters | Theirs has status/owner/all-statuses/archived; ours has none. |
| List web/app | Theirs-only. |
| Create/update `-n` | Theirs = name; ours’ inherited `-n` = limit. |
| Target | Ours `--target`; theirs `--target-date`. |
| Priority/labels | Ours-only. |
| Icon/color/interactive | Theirs-only. |
| Status create | Ours supports all five valid statuses; theirs only Planned/Active/Completed. |
| Status update | **Dangerous/broken there:** ours normalizes `active` to `Active`; theirs sends lowercase and advertises invalid `paused`. `O src/services/initiative.ts:228-235`; `T src/commands/initiative/initiative-update.ts:11-29,158-166`; `T graphql/schema.graphql:11738-11744` |
| Archive/delete | Single-item parity; theirs adds bulk/file/stdin. |
| Unarchive | Theirs-only. |
| Link projects | Theirs `add-project --sort-order` and `remove-project`; absent here. |
| Delete semantics | Both call the trash mutation, but theirs tells users it is permanent; its schema describes trashing. `T src/commands/initiative/initiative-delete.ts:21-29,98-153`; `T graphql/schema.graphql:18442-18452` |

### Auth

| Command/option | Comparison |
|---|---|
| `login` | Ours `--key` and optional workspace alias; theirs `-k/--key`, cleans pasted input and always stores by actual organization slug. Ours permits aliasing but can mislabel a credential. `O src/commands/meta.ts:54-76`; `T src/commands/auth/auth-login.ts:22-78` |
| `list` | Ours lists local slugs/default and supports JSON; theirs validates every credential live and shows identity/errors but has no JSON. `O src/commands/meta.ts:93-109`; `T src/commands/auth/auth-list.ts:31-123` |
| `default` | Ours requires `<slug>`; theirs accepts optional `[workspace]` and prompts. |
| `token` | Both expose the secret; ours can return `{apiKey,workspace}` as JSON, theirs plaintext only. |
| `status` | **Dangerous same name:** ours reports local key resolution and may label an invalid key authenticated; theirs performs live viewer/org validation. `O src/commands/meta.ts:145-167`; `T src/commands/auth/auth-status.ts:26-64` |
| `whoami` | Top-level here; under auth there. Capability parity. |
| `logout` | Ours selects via global `--workspace`, no confirmation; theirs takes positional workspace, can prompt, and has `--yes/--force`. |
| Key precedence | Ours lets explicit key/env override workspace selection; theirs errors when `LINEAR_API_KEY` and `--workspace` coexist. `O src/config.ts:188-231`; `T src/utils/graphql.ts:38-88` |
| Project credentials | Ours deliberately prevents project files from injecting/selecting secrets; theirs accepts project `api_key`/workspace. Security posture differs. |

### API

| Option/behavior | Ours | Theirs |
|---|---|---|
| Query input | Positional, `--query-file`, or stdin | Positional or stdin; positional `-` means stdin |
| Positional `-` | Literal invalid query `"-"`; stdin requires `--query-file -` | Stdin |
| Variables | `--var` strings; typed `--vars`; `--vars-file` | Coercing `--variable`; `@file/@-`; `--variables-json` |
| Merge precedence | File < JSON < repeatable var | JSON base then individual variables |
| Operation name | Advertised `--operation`, but inert | No option |
| Default output | `data` only | Full GraphQL response envelope |
| Full/raw output | `--raw` gives data/extensions | Default envelope |
| Pagination | Follows first discovered connection, cap 1,000 pages | Rejects multiple connections, unbounded loop |
| Silent | No equivalent; global `--quiet` does not suppress payload | `--silent` suppresses response output |
| Endpoint override | Fixed SDK URL | `LINEAR_GRAPHQL_ENDPOINT` |
| Query/vars whole files | Ours-only | Per-variable files only |

Evidence: `O src/commands/api.ts:20-169`; `T src/commands/api.ts:22-188,260-383`; endpoint at `T src/utils/graphql.ts:91-96`.

## 5. Verification of `PARITY.md`

Every identified wrong, stale or overstated claim:

| `PARITY.md` location | Problem |
|---|---|
| `3-4` | Stale provenance: it names `/Users/z/work/linear-cli`, not the prepared v2.1.0 checkout defined by `_context.md:17-23`. |
| `14-17`, `179` | “Full cycle CRUD” is false. Ours ends after update, with no archive/delete. `O src/commands/cycle.ts:23-108`. |
| `15-17`, `180` | “Users” is not a whole reference-absent group: theirs registers `user list`. `T src/commands/user/user.ts:3-11`. |
| `15-17`, `178` | Replying is not unique to ours: theirs has `issue comment add --parent`. `T src/commands/issue/issue-comment-add.ts:18-31,149-156`. |
| `22-25`, `139-143` | “Date ranges” is overstated: theirs has only `--created-after` and `--updated-after`, not before/after ranges. The summary also omits multi-team/state, all-state/assignee, milestone and project-label differences. `T src/commands/issue/issue-query.ts:30-84`. |
| `27`, `123-166` | “Remaining gaps” is not remotely exhaustive: project delete, issue team moves/label replacement, project slug/all-team behavior, health-only updates, config generation, API silent/typed vars, initiative filters and other gaps are absent. |
| `36` | SDK version is stale: ours declares `@linear/sdk ^89.0.0`, not v87. `O package.json:57-61`. |
| `45` | “User-config only” is false. Ours walks ancestors for `.linear.toml` and uses it for nonsecret team/workspace/sort/vcs settings; only credential resolution excludes project config. `O src/config.ts:4-13,141-177,179-260`. |
| `46` | `api --operation` is presented as working, but SDK `rawRequest` ignores the fourth argument. `O src/commands/api.ts:59-61,135-138`; `O node_modules/@linear/sdk/dist/index.d.mts:117-125`. |
| `46`, `79`, `155-156`, `217` | Schema being reference-only is false in four places. Ours implements and registers it. `O src/cli.ts:78-80`; `O src/commands/discover.ts:55-93`. |
| `59` | Relations are framed as part of ours’ advantage, but theirs has add/delete/list with the same four types. `T src/commands/issue/issue-relation.ts:15-365`. Only subscribe/unsubscribe is unique. |
| `61` | “Project near-parity; differing flags” understates project delete vs archive, initiative linking, slug resolution, all-team/status behavior, and the dangerous `update --team` mismatch. `O src/commands/project.ts:145-231`; `T src/commands/project/project-update.ts:55-83`; `T src/commands/project/project-delete.ts:23-67`. |
| `63` | “Ours wins” is too categorical: ours has mutations, but theirs’ view includes cycle issue/state summaries while ours’ detail has no issue list. `O src/services/cycle.ts:54-64`; `T src/commands/cycle/cycle-view.ts:97-159`. |
| `64` | “Label near-parity” is overstated. Theirs lacks update/sub-labels; list scope and `--all/--workspace/--team` semantics materially differ. `O src/commands/label.ts:38-89`; `T src/commands/label/label-list.ts:37-72`. |
| `67`, `180` | Reference user support is marked absent; `user list` exists. `T src/commands/user/user-list.ts:8-47`. |
| `69`, `178` | Reply/thread advantage is overstated. Reply is parity under `--parent`; only resolve/unresolve are unique. |
| `70`, `181` | Reference attachment support is described as only `issue attach`/only attaching. It also has `issue link` for URL attachments and embeds attachments in view. `T src/commands/issue/issue.ts:42-45`; `T src/commands/issue/issue-link.ts:18-22,80-98`. |
| `76` | Auth “near-parity” omits dangerous same-name differences: ours’ status/list are local, theirs validate live; logout selection/confirmation and credential precedence differ. |
| `77-78`, `117-119` | Status-update parity is overstated. Ours rejects health-only updates even though theirs and SDK v89 permit them. `O src/lib/status-update.ts:67-79`; `T src/commands/project-update/project-update-create.ts:149-170`. |
| `82` | Calling config “different purpose” without a gap verdict hides two real capabilities: reference-only config generation and ours-only resolved-config readback. |
| `113-116` | “PR URL the only stdout in `--json`” is false. Ours emits `{url,identifier,title}` or `{web,identifier}`. `O src/commands/issue.ts:458-468`; `O src/output/format.ts:36-43`. |
| `139-143` | It says ours shares the “whole core filter set,” but ours still lacks milestone, project-label, multi-team/state, unassigned and date facets; repeated labels also have opposite Boolean semantics. |
| `157` | Team gap summary omits the distinct `team autolinks` local/GitHub capability. `T src/commands/team/team-autolinks.ts:8-39`. |
| `158` | Initiative summary omits owner/status/archive filters, unarchive/linking, and, critically, the reference’s broken lowercase status mutation. |
| `172`, `176`, `180` | “Whole areas the reference does not cover” overstates organization/users: reference `user list` overlaps both workspace members and user coverage. Ours-only pieces are organization metadata/invites and user view/me. |
| `191-192` | The claimed actual priority range difference is not enforced. Both parsers accept out-of-range numbers; ours uses permissive `parseInt`, theirs bare `Number`. `O src/lib/options.ts:33-36`; `T src/commands/issue/issue-create.ts:450-456`. |
| `211-217` | Roadmap repeats stale items: `--all-teams` and schema are already implemented. `O src/lib/options.ts:75-88`; `O src/commands/discover.ts:55-93`. |

## Top 10 things to add to ours, ranked

1. **Issue team reassignment and exact label replacement** — highest-risk current mismatch; SDK support is direct. **Effort: 1–2 days.**
2. **Expand issue query/search facets, including comment search** — largest everyday discovery gap. **Effort: 2–4 days.**
3. **Local file uploads for attachments and comments** — major terminal/agent workflow gap with SDK signed-upload support. **Effort: 3–5 days.**
4. **Initiative add/remove project plus `project create --initiative`** — core portfolio linkage. **Effort: 1–2 days.**
5. **Project slug resolution, `--all-teams`, and custom-status filtering** — fixes hidden narrowing and URL-derived lookup failures. **Effort: 1 day.**
6. **Allow health-only project/initiative updates** — useful and already permitted by SDK v89. **Effort: under half a day.**
7. **Fix or remove inert `api --operation`** — advertised correctness bug affecting multi-operation documents. **Effort: 1–2 days.**
8. **Enrich issue view with children, attachments, documents and threaded comments** — makes terminal issue context complete. **Effort: 2–4 days.**
9. **Add agent-session list/view** — forward-looking, typed SDK support already exists. **Effort: 2–3 days.**
10. **Complete lifecycle controls: project delete and initiative unarchive** — direct SDK methods, small implementation cost. **Effort: 1 day.**
tokens used
651,659
