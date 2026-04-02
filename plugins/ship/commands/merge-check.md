---
description: Dry-run merge check against a target branch. Pulls the latest target branch and tests if the current branch can merge cleanly. Use when the user says "머지 가능한지 확인해줘", "merge check", "dry run", "충돌 확인", or wants to check mergeability before creating a PR.
---

# merge-check

Pulls the latest target branch and performs a dry-run merge to check for conflicts and compatibility.

## Usage

```
/merge-check [options]
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--target <branch>` | auto-detect | Target branch to merge into (auto-detects remote default branch) |

## Examples

```
/merge-check                        # check against main
/merge-check --target develop       # check against develop
```

## What it does

1. Fetches and pulls the latest target branch
2. Attempts a dry-run merge (no actual commit)
3. Reports conflicts or clean merge status
4. Shows changed file summary between branches
