# linear issue

> Work with issues

Group alias: `i`

_Generated from `linear commands --json`. `linear issue --help` (or `<subcommand> --help`) is authoritative._

Every command also accepts the global flags `-j/--json`, `--no-input`, `-y/--yes`, `-q/--quiet`, `--workspace <slug>`, `--api-key <key>`, `-t/--team <key>`, `-n/--limit <n>`, `--all`, `-f/--fields <a,b,c>`, `--no-ansi` (alias `--no-color`), and `--debug`. Only command-specific options are listed below.

### `linear issue`

Work with issues

Aliases: `i`

```
linear issue [options]
```

### `linear issue archive`

Archive an issue

```
linear issue archive [options] [id]
```

### `linear issue assign`

Assign an issue (use 'me', email, name, or id). Issue defaults to the branch.

```
linear issue assign [options] [idOrAssignee] [assignee]
```

### `linear issue branch`

Print the suggested git branch name

```
linear issue branch [options] [id]
```

### `linear issue comment`

Add a comment to an issue (or use the add/list/update/delete subcommands)

```
linear issue comment [options] [id] [body]
```

| Option               | Description                                 |
| -------------------- | ------------------------------------------- |
| `--body-file <path>` | read comment body from a file ('-' = stdin) |

### `linear issue comment add`

Add a comment to an issue

```
linear issue comment add [options] <issue> [body]
```

| Option               | Description                                 |
| -------------------- | ------------------------------------------- |
| `--body-file <path>` | read comment body from a file ('-' = stdin) |

### `linear issue comment delete`

Delete a comment

```
linear issue comment delete [options] <commentId>
```

### `linear issue comment list`

List comments on an issue

```
linear issue comment list [options] <issue>
```

### `linear issue comment update`

Update a comment's body

```
linear issue comment update [options] <commentId> [body]
```

| Option               | Description                             |
| -------------------- | --------------------------------------- |
| `--body-file <path>` | read new body from a file ('-' = stdin) |

### `linear issue comments`

List comments on an issue

```
linear issue comments [options] [id]
```

### `linear issue create`

Create a new issue

Aliases: `new`

```
linear issue create [options]
```

| Option                      | Description                                |
| --------------------------- | ------------------------------------------ |
| `--title <title>`           | issue title                                |
| `-d, --description <text>`  | issue description (body)                   |
| `--description-file <path>` | read description from a file ('-' = stdin) |
| `--editor`                  | compose the description in $EDITOR         |
| `-a, --assignee <who>`      | assignee (me\|email\|name\|id)             |
| `-s, --state <name>`        | workflow state name or type                |
| `-P, --priority <0-4>`      | priority                                   |
| `-l, --label <name>`        | label (repeatable / comma-separated)       |
| `-p, --project <name>`      | project name or id                         |
| `--milestone <name>`        | project milestone (requires --project)     |
| `--cycle <n>`               | cycle number, name, id, or 'current'       |
| `--estimate <n>`            | estimate points                            |
| `--parent <id>`             | parent issue id                            |
| `--due <date>`              | due date (YYYY-MM-DD)                      |

### `linear issue delete`

Delete (trash) an issue

Aliases: `rm`

```
linear issue delete [options] [id]
```

### `linear issue describe`

Print the issue title and a commit-message trailer (Fixes <ID>)

```
linear issue describe [options] [id]
```

| Option             | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `-r, --references` | use a 'References <ID>' trailer instead of 'Fixes <ID>' |

### `linear issue id`

Print the current issue's identifier

```
linear issue id [options] [id]
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

### `linear issue pull-request`

Create a GitHub PR for the issue via the gh CLI

Aliases: `pr`

```
linear issue pull-request [options] [id]
```

| Option            | Description                              |
| ----------------- | ---------------------------------------- |
| `--base <branch>` | base branch for the PR                   |
| `--head <branch>` | head branch for the PR                   |
| `--draft`         | create the PR as a draft                 |
| `--title <title>` | PR title (defaults to the issue title)   |
| `-w, --web`       | open the PR creation page in the browser |

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

### `linear issue start`

Checkout the issue's git branch (and optionally move its state)

```
linear issue start [options] [id]
```

| Option           | Description                                 |
| ---------------- | ------------------------------------------- |
| `--state <name>` | also move the issue to this state           |
| `--move`         | move the issue to the first 'started' state |
| `--no-checkout`  | do not touch git; only update state         |

### `linear issue state`

Move an issue to a workflow state. Issue defaults to the branch.

```
linear issue state [options] [idOrState] [state]
```

### `linear issue subscribe`

Subscribe to an issue

```
linear issue subscribe [options] [id]
```

### `linear issue title`

Print the issue title

```
linear issue title [options] [id]
```

### `linear issue unarchive`

Unarchive an issue

```
linear issue unarchive [options] [id]
```

### `linear issue unsubscribe`

Unsubscribe from an issue

```
linear issue unsubscribe [options] [id]
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
| `--add-label <name>`        | add a label (repeatable)                                |
| `--remove-label <name>`     | remove a label (repeatable)                             |
| `--unassign`                | clear the assignee                                      |
| `--clear-cycle`             | remove the issue from its cycle                         |

### `linear issue url`

Print the issue URL

```
linear issue url [options] [id]
```

### `linear issue view`

Show an issue (defaults to the current branch's issue)

```
linear issue view [options] [id]
```

| Option       | Description                                       |
| ------------ | ------------------------------------------------- |
| `-w, --web`  | open the issue in the browser instead of printing |
| `--comments` | include recent comments                           |
