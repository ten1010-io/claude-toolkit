---
name: merge-check
description: Dry-run merge check against a target branch. Pulls the latest target branch and tests if the current branch can merge cleanly. Use when the user says "머지 가능한지 확인해줘", "merge check", "dry run", "충돌 확인", or wants to check mergeability before creating a PR.
---

# Ship Merge Check — Dry-run Merge Validator

Fetches the latest target branch, attempts a trial merge, and reports whether the current branch can merge cleanly or has conflicts.

## Language

**CRITICAL:** You MUST detect the user's language from their messages and use that language for ALL interactions. The English in this document is only a reference for the AI.

## Trigger

Use when the user wants to check if their branch can merge cleanly or do a dry-run before creating a PR.

## Arguments

- `--target <branch>` — Target branch to merge into (default: `main`)

## Workflow

### Step 1: Validate git state

```bash
git status
git branch --show-current
git stash list
```

- Confirm on a feature branch (NOT main/master)
- Stash uncommitted changes if present (restore after)

### Step 2: Determine target branch

1. `--target` option if provided
2. Auto-detect: `git remote show origin | grep 'HEAD branch' | sed 's/.*: //'`
3. Fall back to `main`

### Step 3: Fetch latest target branch

```bash
git fetch origin <target>
```

### Step 4: Show branch divergence

```bash
git log --oneline origin/<target>..HEAD
git log --oneline HEAD..origin/<target>
git diff --stat origin/<target>...HEAD
```

### Step 5: Attempt dry-run merge

```bash
git merge --no-commit --no-ff origin/<target>
```

- **No conflicts**: report clean, then `git merge --abort`
- **Conflicts**: list conflicting files, show conflict markers (max 20 lines/file), then `git merge --abort`

### Step 6: Restore working state

```bash
git stash pop  # only if stashed in Step 1
```

### Step 7: Report result

**Clean:**
```
✅ Clean merge possible into origin/<target>
- X commits ahead, Y commits behind
- Z files changed
```

**Conflicts:**
```
❌ Merge conflicts detected with origin/<target>
- N conflicting files: ...
```

## Error handling

- **CRITICAL:** Always abort merge and restore stash even if an error occurs mid-process. Never leave the repo in a dirty merge state.
- On main/master → refuse
- Fetch fails → report and stop
