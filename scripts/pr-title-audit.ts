/** Require squash commits to give Release Please one Conventional Commit per pull request. */

const CONVENTIONAL_TITLE =
  /^(?:feat|fix|perf|refactor|docs|test|build|ci|chore|revert)(?:\([a-z0-9][a-z0-9._/-]*\))?!?: \S.+$/;

export function validatePullRequestTitle(title: string): string | undefined {
  if (CONVENTIONAL_TITLE.test(title)) return undefined;
  return (
    "pull request title must be a Conventional Commit, for example " +
    "'feat(auth): add browser login' or 'fix!: remove deprecated output'"
  );
}

if (import.meta.main) {
  const title = process.argv.slice(2).join(" ");
  const error = validatePullRequestTitle(title);
  if (error) {
    console.error(`pr-title: ${error}; got ${JSON.stringify(title)}`);
    process.exit(1);
  }
  console.error(`pr-title: ${title}`);
}
