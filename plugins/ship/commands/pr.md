---
description: Generate a PR description from current branch changes and create a pull request. Use when the user says "PR 올려줘", "PR 작성해줘", "push PR", "create PR", or asks to ship their work.
---

# pr

Analyzes all commits on the current branch (vs base branch), generates a PR title and description, then creates and pushes the pull request.

## Usage

```
/pr [options]
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--base <branch>` | main | Base branch to compare against |
| `--draft` | No | Create as draft PR |

## Examples

```
/pr                        # PR to main
/pr --base develop         # PR to develop
/pr --draft                # Draft PR to main
```

## What it does

1. Detects base branch and analyzes `git diff <base>...HEAD`
2. Reads full commit history since branch diverged
3. Generates PR title (< 70 chars) and structured description
4. Pushes branch to remote with `-u` flag
5. Creates PR via `gh pr create`
