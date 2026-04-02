---
name: merge-check
description: Dry-run merge check against a target branch. Pulls the latest target branch and tests if the current branch can merge cleanly. Use when the user says "머지 가능한지 확인해줘", "merge check", "dry run", "충돌 확인", or wants to check mergeability before creating a PR.
---

# Ship Merge Check — Dry-run Merge Validator

Fetches the latest target branch, attempts a trial merge, and reports whether the current branch can merge cleanly or has conflicts.

## Language

**CRITICAL:** You MUST detect the user's language from their messages and use that language for ALL interactions — status updates, error messages, and result summaries. The English in this document is only a reference for the AI.

## Trigger

Use when the user wants to check if their branch can merge cleanly, verify there are no conflicts, or do a dry-run before creating a PR.

## Arguments

- `--target <branch>` — Target branch to merge into (default: `main`)

## Workflow

Follow the steps below **exactly**.

### Step 1: Validate git state

Run these commands in parallel:

```bash
git status
git branch --show-current
git stash list
```

- Confirm we are on a feature branch (NOT on main/master)
- If there are uncommitted changes, stash them automatically before proceeding (restore after check is done)
- Record whether a stash was created so we can restore it later

### Step 2: Determine target branch

Resolve the target branch in this priority order:
1. If `--target` option is provided, use that
2. Otherwise, auto-detect the remote default branch:
   ```bash
   git remote show origin | grep 'HEAD branch' | sed 's/.*: //'
   ```
3. If auto-detect fails, fall back to `main`

Verify the resolved target branch exists: `git rev-parse --verify <target>` or `git rev-parse --verify origin/<target>`

### Step 3: Fetch latest target branch

```bash
git fetch origin <target>
```

- Always fetch to ensure we have the latest remote state
- If fetch fails, report the error and stop

### Step 4: Show branch divergence

Run these commands in parallel:

```bash
git log --oneline origin/<target>..HEAD
git log --oneline HEAD..origin/<target>
git diff --stat origin/<target>...HEAD
```

Report to the user:
- Number of commits ahead (your changes)
- Number of commits behind (changes on target since you branched)
- File change summary

### Step 5: Attempt dry-run merge

```bash
git merge --no-commit --no-ff origin/<target>
```

**If merge succeeds (no conflicts):**
- Report clean merge status
- Show the list of files that would be merged
- Abort the merge immediately:
  ```bash
  git merge --abort
  ```

**If merge fails (conflicts):**
- Capture the conflict output
- List all conflicting files:
  ```bash
  git diff --name-only --diff-filter=U
  ```
- For each conflicting file, show the conflict markers with surrounding context (max 20 lines per file)
- Abort the merge:
  ```bash
  git merge --abort
  ```

### Step 6: Restore working state

- If changes were stashed in Step 1, restore them:
  ```bash
  git stash pop
  ```
- Verify we are back on the original branch in a clean state

### Step 7: Report result

**Clean merge:**
```
✅ Clean merge possible into origin/<target>
- X commits ahead, Y commits behind
- Z files changed
```

**Conflicts found:**
```
❌ Merge conflicts detected with origin/<target>
- X commits ahead, Y commits behind
- N conflicting files:
  - path/to/file1.ts (both modified)
  - path/to/file2.ts (both modified)
```

Then show conflict details for each file.

## Error handling

- If not on a feature branch (on main/master), refuse and explain why
- If fetch fails (no network, no remote), report the error clearly
- If stash/unstash fails, warn the user and show how to recover manually
- **CRITICAL:** Always abort the merge and restore stashed changes, even if an error occurs mid-process. Never leave the repo in a dirty merge state.
