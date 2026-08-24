# Agent skills

The `skills/` directory contains the portable, canonical skill sources for this
repository. Each skill uses the open `SKILL.md` convention and must remain usable
by both Codex and Claude Code without agent-specific instructions.

Claude Code receives the listed skills through `.claude-plugin/plugin.json` when
this repository is installed as its plugin. A Codex user can add or install the
same skill directory in their Codex skills location; scheduled Codex tasks can
also invoke a repository skill explicitly by path.

The cloud maintenance routine reads
`skills/linear-sdk-cli-maintenance/SKILL.md` before it acts. Keep routine-specific
schedule and notification settings in the routine; keep maintenance procedure and
guardrails in the skill.
