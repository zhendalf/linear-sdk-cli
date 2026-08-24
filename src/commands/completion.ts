/**
 * `linear completion <shell>` — print a shell completion script to stdout.
 *
 * These are static, hand-written completions that defer to the binary for help.
 * Kept intentionally simple (top-level commands + common flags); they are
 * generated from the live command tree so they don't drift.
 */

import { Command } from "commander";
import { action } from "../lib/action.js";
import { usageError } from "../lib/errors.js";

export type Shell = "bash" | "zsh" | "fish";

/** Collect top-level command names from the root program. */
export function topLevelCommands(program: Command): string[] {
  return program.commands
    .map((c) => c.name())
    .filter((n) => n && n !== "completion")
    .sort();
}

export function completionScript(shell: Shell, commands: string[]): string {
  const list = commands.join(" ");
  switch (shell) {
    case "bash":
      return `# linear bash completion. Add to ~/.bashrc:  source <(linear completion bash)
_linear_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${list}" -- "$cur") )
  fi
}
complete -F _linear_completions linear lin
`;
    case "zsh":
      return `#compdef linear lin
# linear zsh completion. Add to your fpath or:  source <(linear completion zsh)
_linear() {
  local -a cmds
  cmds=(${commands.map((c) => `'${c}'`).join(" ")})
  if (( CURRENT == 2 )); then
    _describe 'command' cmds
  fi
}
compdef _linear linear lin
`;
    case "fish":
      return `# linear fish completion:  linear completion fish > ~/.config/fish/completions/linear.fish
${commands.map((c) => `complete -c linear -n '__fish_use_subcommand' -a '${c}'`).join("\n")}
${commands.map((c) => `complete -c lin -n '__fish_use_subcommand' -a '${c}'`).join("\n")}
`;
  }
}

export function registerCompletion(program: Command): void {
  program
    .command("completion <shell>")
    .description("Output a shell completion script (bash|zsh|fish)")
    .action(
      action(async (ctx, _opts, shell: string) => {
        if (shell !== "bash" && shell !== "zsh" && shell !== "fish") {
          throw usageError(`Unsupported shell '${shell}'. Use bash, zsh, or fish.`);
        }
        const script = completionScript(shell, topLevelCommands(program));
        process.stdout.write(script);
      }),
    );
}
