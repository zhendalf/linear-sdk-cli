# linear issue

> Work with issues

Group alias: `i`

_Generated from `linear commands --json`. `linear issue --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `--access-token <token>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear issue`

Work with issues

Aliases: `i`

```
linear issue [options]
```

**Output (`--json`)**: a bare object — runs `issue view` by default

```text
id: string
identifier: string
title: string
description: string | null
priority: number
priorityLabel: string
estimate: number | null
url: string
branchName: string
dueDate: string | null
createdAt: string
updatedAt: string
archivedAt: string | null
trashed: boolean
startedAt: string | null
completedAt: string | null
canceledAt: string | null
state: {id: string, name: string, type: string} | null
assignee: {id: string, displayName: string, email: string} | null
team: {id: string, key: string, name: string} | null
project: {id: string, name: string} | null
milestone: {id: string, name: string} | null
cycle: {id: string, number: number, name: string | null} | null
parent: {id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null} | null
children: Array<{id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null}>
labels: Array<{id: string, name: string}>
subscribers: Array<{id: string, displayName: string}>
attachments: Array<{id: string, title: string, url: string, subtitle: string | null, sourceType: string | null, createdAt: string}>
documents: Array<{id: string, title: string, slugId: string, url: string, createdAt: string, updatedAt: string}>
relations: Array<{id: string, type: string, issue: {id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null}, relatedIssue: {id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null}}>
inverseRelations: Array<{id: string, type: string, issue: {id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null}, relatedIssue: {id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null}}>
comments: Array<{id: string, body: string, url: string, createdAt: string, editedAt: string | null, resolvedAt: string | null, parent: {id: string} | null, user: {id: string, displayName: string} | null, externalUser: {id: string, displayName: string} | null, resolvingCommentId: string | null, resolvingUser: {id: string, displayName: string} | null}>
```

With `--web`: a receipt object

```text
id: string
identifier: string
url: string
opened: boolean
```

With `--app`: a receipt object

```text
id: string
identifier: string
url: string
opened: boolean
```

### `linear issue agent-session`

Inspect the agent sessions on an issue

```
linear issue agent-session [options]
```

### `linear issue agent-session list`

List an issue's agent sessions (newest first)

Aliases: `ls`

```
linear issue agent-session list [options] [issue]
```

| Option              | Description                                        |
| ------------------- | -------------------------------------------------- |
| `--status <status>` | only sessions in this status                       |
| `--all-issues`      | every session in the workspace, ignoring the issue |

**Output (`--json`)**: a bare array of objects

```text
id: string
status: string
type: string | null
summary: string | null
createdAt: string
startedAt: string | null
endedAt: string | null
url: string | null
issue: {id: string, identifier: string, title: string} | null
agent: {id: string, name: string, displayName: string} | null
creator: {id: string, name: string, displayName: string} | null
```

### `linear issue agent-session view`

Show an agent session and its activity

Aliases: `show`

```
linear issue agent-session view [options] <id>
```

**Output (`--json`)**: a bare object

```text
id: string
status: string
type: string | null
summary: string | null
createdAt: string
startedAt: string | null
endedAt: string | null
url: string | null
issue: {id: string, identifier: string, title: string} | null
agent: {id: string, name: string, displayName: string} | null
creator: {id: string, name: string, displayName: string} | null
updatedAt: string
dismissedAt: string | null
dismissedBy: {id: string, name: string, displayName: string} | null
externalLink: string | null
activities: Array<{id: string, createdAt: string, type: string, body: string | null, action: string | null, parameter: string | null, result: string | null}>
activitiesTruncated: boolean
```

### `linear issue archive`

Archive an issue

```
linear issue archive [options] [id]
```

| Option               | Description                                      |
| -------------------- | ------------------------------------------------ |
| `--bulk <ids>`       | archive comma-separated issue ids (repeatable)   |
| `--bulk-file <path>` | archive issue ids from a file (one per line)     |
| `--bulk-stdin`       | archive issue ids read from stdin (one per line) |

**Output (`--json`)**: a receipt object

```text
id: string
identifier: string
archived: boolean
```

With `--bulk`: a receipt object

```text
action: string
results: Array<{input: string, id?: string, identifier?: string, archived?: boolean, deleted?: boolean, error?: {message: string, code: string}}>
succeeded: number
failed: number
```

### `linear issue assign`

Assign an issue (use 'me', email, name, or id). Issue defaults to the branch.

```
linear issue assign [options] [idOrAssignee] [assignee]
```

**Output (`--json`)**: a receipt object

```text
id: string
identifier: string
```

### `linear issue attach`

Upload files and attach them to an issue (private by default)

```
linear issue attach [options] <issue> <file...>
```

| Option             | Description                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| `--title <title>`  | attachment title (single file only; default: the file name)                   |
| `--comment <body>` | also post a comment with this body embedding the files as markdown            |
| `--public`         | upload to a public, world-readable URL (raster images only; default: private) |

**Output (`--json`)**: a bare array of objects — one row per uploaded file; `comment` is on every row when --comment posted one

```text
id: string
title: string
url: string
assetUrl: string
contentType: string
size: number
comment?: {id: string, url: string}
```

### `linear issue branch`

Print the suggested git branch name

```
linear issue branch [options] [id]
```

**Output (`--json`)**: a receipt object

```text
branch: string
```

### `linear issue comment`

Add a comment to an issue; on a matching branch, `issue comment "<body>"` is enough (or use the add/list/update/delete subcommands)

```
linear issue comment [options] [id] [body]
```

| Option               | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `--body-file <path>` | read comment body from a file ('-' = stdin)                        |
| `--mention <user>`   | prepend a real Linear mention (name, email, me, or id; repeatable) |

**Output (`--json`)**: a receipt object — the bare form adds a comment; add/list/update/delete are subcommands

```text
id: string
issue: string
```

### `linear issue comment add`

Add a comment to an issue (images uploaded with --attach render inline)

```
linear issue comment add [options] <issue> [body]
```

| Option               | Description                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `--body-file <path>` | read comment body from a file ('-' = stdin)                                               |
| `--mention <user>`   | prepend a real Linear mention (name, email, me, or id; repeatable)                        |
| `--attach <file>`    | upload a file and embed it in the comment (images inline; repeatable; private by default) |
| `--public`           | upload the attachments to public, world-readable URLs (raster images only)                |

**Output (`--json`)**: a receipt object — `attachments` only with --attach

```text
id: string
issue: string
url: string
attachments?: Array<{filename: string, assetUrl: string, contentType: string, size: number}>
```

### `linear issue comment delete`

Delete a comment

```
linear issue comment delete [options] <commentId>
```

**Output (`--json`)**: a receipt object

```text
id: string
deleted: boolean
```

### `linear issue comment list`

List comments on an issue

```
linear issue comment list [options] <issue>
```

**Output (`--json`)**: a bare array of objects

```text
id: string
body: string
user: {id: string, displayName: string} | null
createdAt: string
editedAt: string | null
resolvedAt: string | null
parent: {id: string} | null
url: string
```

### `linear issue comment update`

Update a comment's body

```
linear issue comment update [options] <commentId> [body]
```

| Option               | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `--body-file <path>` | read new body from a file ('-' = stdin)                            |
| `--mention <user>`   | prepend a real Linear mention (name, email, me, or id; repeatable) |

**Output (`--json`)**: a receipt object

```text
id: string
url: string
```

### `linear issue comments`

List comments on an issue

```
linear issue comments [options] [id]
```

**Output (`--json`)**: a bare array of objects

```text
id: string
body: string
user: {id: string, displayName: string} | null
createdAt: string
editedAt: string | null
resolvedAt: string | null
parent: {id: string} | null
url: string
```

### `linear issue create`

Create a new issue

Aliases: `new`

```
linear issue create [options]
```

| Option                      | Description                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `--title <title>`           | issue title                                                                                          |
| `-d, --description <text>`  | issue description (body)                                                                             |
| `--description-file <path>` | read description from a file ('-' = stdin)                                                           |
| `--editor`                  | compose the description in $EDITOR                                                                   |
| `-a, --assignee <who>`      | assignee (me\|email\|name\|id)                                                                       |
| `-s, --state <name>`        | workflow state name or type                                                                          |
| `-P, --priority <0-4>`      | priority                                                                                             |
| `-l, --label <name>`        | label (repeatable / comma-separated)                                                                 |
| `-p, --project <name>`      | project name or id                                                                                   |
| `--milestone <name>`        | project milestone (requires --project)                                                               |
| `--cycle <n>`               | cycle number, name, id, or 'current'                                                                 |
| `--estimate <n>`            | estimate points                                                                                      |
| `--parent <id>`             | parent issue id (the sub-issue joins the parent's project unless --project says otherwise)           |
| `--due <date>`              | due date (YYYY-MM-DD)                                                                                |
| `--template <name\|id>`     | create from an issue template (the team's or a shared one)                                           |
| `--no-default-template`     | do not apply the team's default issue template                                                       |
| `--start`                   | then start work: check out the branch, move to the first 'started' state (or --state), assign to you |

**Output (`--json`)**: a receipt object

```text
id: string
identifier: string
url: string
```

With `--start`: the same, plus:

```text
branch: string
checkedOut: boolean
stateChanged: boolean
```

### `linear issue delete`

Delete (trash) an issue

Aliases: `rm`

```
linear issue delete [options] [id]
```

| Option               | Description                                     |
| -------------------- | ----------------------------------------------- |
| `--bulk <ids>`       | delete comma-separated issue ids (repeatable)   |
| `--bulk-file <path>` | delete issue ids from a file (one per line)     |
| `--bulk-stdin`       | delete issue ids read from stdin (one per line) |

**Output (`--json`)**: a receipt object

```text
id: string
identifier: string
deleted: boolean
```

With `--bulk`: a receipt object

```text
action: string
results: Array<{input: string, id?: string, identifier?: string, archived?: boolean, deleted?: boolean, error?: {message: string, code: string}}>
succeeded: number
failed: number
```

### `linear issue describe`

Print a commit message for the issue: 'ID Title' plus Linear-issue trailers

```
linear issue describe [options] [id]
```

| Option             | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `-r, --references` | link without closing: 'References <ID>' instead of 'Fixes <ID>' |

**Output (`--json`)**: a receipt object — `trailer` is the magic-word phrase (Fixes TES-1); `message` the full commit text as printed

```text
identifier: string
title: string
url: string
trailer: string
message: string
```

### `linear issue id`

Print the current issue's identifier

```
linear issue id [options] [id]
```

**Output (`--json`)**: a receipt object — `id` is the identifier (TES-123), not the UUID

```text
id: string
```

### `linear issue label`

Add/remove labels on an issue

```
linear issue label [options] [id]
```

| Option            | Description                 |
| ----------------- | --------------------------- |
| `--add <name>`    | add a label (repeatable)    |
| `--remove <name>` | remove a label (repeatable) |

**Output (`--json`)**: a receipt object

```text
id: string
identifier: string
```

### `linear issue list`

List issues with filters

Aliases: `ls`, `query`

```
linear issue list [options]
```

| Option                   | Description                                               |
| ------------------------ | --------------------------------------------------------- |
| `-t, --team <key>`       | filter by team key (repeatable; default: configured team) |
| `-s, --state <name>`     | filter by workflow state name/type (repeatable)           |
| `-a, --assignee <who>`   | filter by assignee (me\|email\|name)                      |
| `-U, --unassigned`       | only issues with no assignee                              |
| `-p, --project <name>`   | filter by project                                         |
| `--project-label <name>` | filter by the project's label (excludes --project)        |
| `--milestone <name>`     | filter by project milestone                               |
| `-l, --label <name>`     | filter by label (repeat to narrow)                        |
| `-P, --priority <0-4>`   | filter by priority                                        |
| `--cycle <n>`            | cycle number, name, id, or 'current'                      |
| `--created-after <date>` | only issues created at/after a date (YYYY-MM-DD)          |
| `--updated-after <date>` | only issues updated at/after a date (YYYY-MM-DD)          |
| `--all-teams`            | search every team, ignoring the default team              |
| `--include-archived`     | include archived issues                                   |
| `--query <text>`         | full-text search                                          |
| `--sort <field>`         | sort order                                                |

**Output (`--json`)**: a bare array of objects

```text
id: string
identifier: string
title: string
priority: number
priorityLabel: string
estimate: number | null
url: string
updatedAt: string
state: {name: string, type: string} | null
assignee: {displayName: string} | null
project: {name: string} | null
milestone: {id: string, name: string} | null
cycle: {id: string, number: number, name: string | null} | null
labels: string[]
archivedAt: string | null
trashed: boolean
startedAt: string | null
completedAt: string | null
canceledAt: string | null
```

### `linear issue mine`

List your unstarted issues (--all-states for every state)

```
linear issue mine [options]
```

| Option                   | Description                                               |
| ------------------------ | --------------------------------------------------------- |
| `-t, --team <key>`       | filter by team key (repeatable; default: configured team) |
| `-s, --state <name>`     | filter by workflow state name/type (repeatable)           |
| `-p, --project <name>`   | filter by project                                         |
| `--project-label <name>` | filter by the project's label (excludes --project)        |
| `--milestone <name>`     | filter by project milestone                               |
| `-l, --label <name>`     | filter by label (repeat to narrow)                        |
| `-P, --priority <0-4>`   | filter by priority                                        |
| `--cycle <n>`            | cycle number, name, id, or 'current'                      |
| `--created-after <date>` | only issues created at/after a date (YYYY-MM-DD)          |
| `--updated-after <date>` | only issues updated at/after a date (YYYY-MM-DD)          |
| `--all-teams`            | search every team, ignoring the default team              |
| `--include-archived`     | include archived issues                                   |
| `--query <text>`         | full-text search                                          |
| `--sort <field>`         | sort order                                                |
| `--all-states`           | include every workflow state, not just unstarted          |

**Output (`--json`)**: a bare array of objects

```text
id: string
identifier: string
title: string
priority: number
priorityLabel: string
estimate: number | null
url: string
updatedAt: string
state: {name: string, type: string} | null
assignee: {displayName: string} | null
project: {name: string} | null
milestone: {id: string, name: string} | null
cycle: {id: string, number: number, name: string | null} | null
labels: string[]
archivedAt: string | null
trashed: boolean
startedAt: string | null
completedAt: string | null
canceledAt: string | null
```

### `linear issue pull-request`

Create a GitHub PR for the issue via the gh CLI

Aliases: `pr`

```
linear issue pull-request [options] [id]
```

| Option            | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `--base <branch>` | base branch for the PR                                 |
| `--head <branch>` | head branch for the PR                                 |
| `--draft`         | create the PR as a draft                               |
| `--title <title>` | PR title after the issue id (default: the issue title) |
| `-w, --web`       | open the PR creation page in the browser               |

**Output (`--json`)**: a receipt object

```text
url: string
identifier: string
title: string
```

With `--web`: a receipt object

```text
web: boolean
identifier: string
```

### `linear issue relation`

Manage issue relations: op = add|remove|list

```
linear issue relation [options] <id> <op> [other]
```

| Option         | Description                      |
| -------------- | -------------------------------- |
| `--blocks`     | relation type: blocks            |
| `--blocked-by` | relation type: blocked by        |
| `--related`    | relation type: related (default) |
| `--duplicate`  | relation type: duplicate         |

**Output (`--json`)**: a receipt object — for op=add|remove

```text
issueId: string
issueIdentifier: string
otherId: string
otherIdentifier: string
type: string
op: string
```

With `op=list`: a bare array of objects

```text
type: string
issue: string
title: string
```

### `linear issue search`

Full-text search across issues (scoped to the default team; --all-teams widens)

```
linear issue search [options] <text>
```

| Option                   | Description                                               |
| ------------------------ | --------------------------------------------------------- |
| `-t, --team <key>`       | filter by team key (repeatable; default: configured team) |
| `-s, --state <name>`     | filter by workflow state name/type (repeatable)           |
| `-a, --assignee <who>`   | filter by assignee (me\|email\|name)                      |
| `-U, --unassigned`       | only issues with no assignee                              |
| `-p, --project <name>`   | filter by project                                         |
| `--project-label <name>` | filter by the project's label (excludes --project)        |
| `--milestone <name>`     | filter by project milestone                               |
| `-l, --label <name>`     | filter by label (repeat to narrow)                        |
| `-P, --priority <0-4>`   | filter by priority                                        |
| `--cycle <n>`            | cycle number, name, id, or 'current'                      |
| `--created-after <date>` | only issues created at/after a date (YYYY-MM-DD)          |
| `--updated-after <date>` | only issues updated at/after a date (YYYY-MM-DD)          |
| `--all-teams`            | search every team, ignoring the default team              |
| `--include-archived`     | include archived issues                                   |
| `--search-comments`      | match comment bodies as well as titles and descriptions   |

**Output (`--json`)**: a bare array of objects

```text
id: string
identifier: string
title: string
priority: number
priorityLabel: string
estimate: number | null
url: string
updatedAt: string
state: {name: string, type: string} | null
assignee: {displayName: string} | null
project: {name: string} | null
milestone: {id: string, name: string} | null
cycle: {id: string, number: number, name: string | null} | null
labels: string[]
archivedAt: string | null
trashed: boolean
startedAt: string | null
completedAt: string | null
canceledAt: string | null
```

### `linear issue start`

Start work on an issue: check out its branch and move it to the first 'started' state

```
linear issue start [options] [id]
```

| Option           | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `--state <name>` | move to this state instead of the first 'started' one |
| `--no-move`      | do not change the state; only check out the branch    |
| `--no-checkout`  | do not touch git; only update state                   |

**Output (`--json`)**: a receipt object

```text
id: string
identifier: string
branch: string
checkedOut: boolean
stateChanged: boolean
```

### `linear issue state`

Move an issue to a workflow state. Issue defaults to the branch.

```
linear issue state [options] [idOrState] [state]
```

**Output (`--json`)**: a receipt object

```text
id: string
identifier: string
```

### `linear issue subscribe`

Subscribe to an issue

```
linear issue subscribe [options] [id]
```

**Output (`--json`)**: a receipt object

```text
id: string
identifier: string
subscribed: boolean
```

### `linear issue title`

Print the issue title

```
linear issue title [options] [id]
```

**Output (`--json`)**: a receipt object

```text
title: string
```

### `linear issue unarchive`

Unarchive an issue

```
linear issue unarchive [options] [id]
```

**Output (`--json`)**: a receipt object

```text
id: string
identifier: string
archived: boolean
```

### `linear issue unsubscribe`

Unsubscribe from an issue

```
linear issue unsubscribe [options] [id]
```

**Output (`--json`)**: a receipt object

```text
id: string
identifier: string
subscribed: boolean
```

### `linear issue update`

Update an issue

Aliases: `edit`

```
linear issue update [options] [id]
```

| Option                      | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `--title <title>`           | new title                                               |
| `-d, --description <text>`  | new description                                         |
| `--description-file <path>` | read description from a file ('-' = stdin)              |
| `-t, --team <key>`          | move the issue to another team (changes its identifier) |
| `-a, --assignee <who>`      | assignee (me\|email\|name\|id)                          |
| `-s, --state <name>`        | workflow state name or type                             |
| `-P, --priority <0-4>`      | priority                                                |
| `-p, --project <name>`      | project name or id                                      |
| `--milestone <name>`        | project milestone                                       |
| `--cycle <n>`               | cycle number, name, id, or 'current'                    |
| `--estimate <n>`            | estimate points                                         |
| `--parent <id>`             | parent issue id                                         |
| `--due <date>`              | due date (YYYY-MM-DD)                                   |
| `-l, --label <name>`        | replace all labels (repeatable / comma-separated)       |
| `--add-label <name>`        | add a label (repeatable)                                |
| `--remove-label <name>`     | remove a label (repeatable)                             |
| `--unassign`                | clear the assignee                                      |
| `--clear-cycle`             | remove the issue from its cycle                         |

**Output (`--json`)**: a receipt object

```text
id: string
identifier: string
url: string
```

### `linear issue url`

Print the issue URL

```
linear issue url [options] [id]
```

**Output (`--json`)**: a receipt object

```text
url: string
```

### `linear issue view`

Show an issue (defaults to the current branch's issue)

```
linear issue view [options] [id]
```

| Option                    | Description                                       |
| ------------------------- | ------------------------------------------------- |
| `-w, --web`               | open the issue in the browser instead of printing |
| `--app`                   | open the issue in Linear.app instead of printing  |
| `--no-comments`           | exclude comments from the output                  |
| `--show-resolved-threads` | include resolved comment threads                  |

**Output (`--json`)**: a bare object

```text
id: string
identifier: string
title: string
description: string | null
priority: number
priorityLabel: string
estimate: number | null
url: string
branchName: string
dueDate: string | null
createdAt: string
updatedAt: string
archivedAt: string | null
trashed: boolean
startedAt: string | null
completedAt: string | null
canceledAt: string | null
state: {id: string, name: string, type: string} | null
assignee: {id: string, displayName: string, email: string} | null
team: {id: string, key: string, name: string} | null
project: {id: string, name: string} | null
milestone: {id: string, name: string} | null
cycle: {id: string, number: number, name: string | null} | null
parent: {id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null} | null
children: Array<{id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null}>
labels: Array<{id: string, name: string}>
subscribers: Array<{id: string, displayName: string}>
attachments: Array<{id: string, title: string, url: string, subtitle: string | null, sourceType: string | null, createdAt: string}>
documents: Array<{id: string, title: string, slugId: string, url: string, createdAt: string, updatedAt: string}>
relations: Array<{id: string, type: string, issue: {id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null}, relatedIssue: {id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null}}>
inverseRelations: Array<{id: string, type: string, issue: {id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null}, relatedIssue: {id: string, identifier: string, title: string, state: {id: string, name: string, type: string} | null}}>
comments: Array<{id: string, body: string, url: string, createdAt: string, editedAt: string | null, resolvedAt: string | null, parent: {id: string} | null, user: {id: string, displayName: string} | null, externalUser: {id: string, displayName: string} | null, resolvingCommentId: string | null, resolvingUser: {id: string, displayName: string} | null}>
```

With `--web`: a receipt object

```text
id: string
identifier: string
url: string
opened: boolean
```

With `--app`: a receipt object

```text
id: string
identifier: string
url: string
opened: boolean
```
