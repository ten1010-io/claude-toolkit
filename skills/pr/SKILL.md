---
name: pr
description: Generate a PR description from current branch changes and create a pull request. Use when the user says "PR 올려줘", "PR 작성해줘", "push PR", "create PR", or asks to ship their work.
---

# Ship PR — Pull Request Generator

Analyzes all changes on the current branch compared to the base branch, generates a comprehensive PR title and description, then pushes and creates the pull request.

## Language

**CRITICAL:** You MUST detect the user's language from their messages and use that language for ALL interactions — status updates, error messages, and result summaries. The English in this document is only a reference for the AI.

## Trigger

Use when the user wants to create a pull request, push their work for review, or asks to ship changes.

## Arguments

- `--base <branch>` — Base branch to compare against (default: `main`)
- `--draft` — Create as a draft PR

## Workflow

Follow the steps below **exactly**.

### Step 1: Validate git state

Run these commands in parallel:

```bash
git status
git branch --show-current
git remote -v
```

- Confirm we are on a feature branch (NOT on main/master)
- Confirm there is a remote configured
- If there are uncommitted changes, warn the user and ask whether to proceed or commit first

### Step 2: Determine base branch

Resolve the base branch in this priority order:
1. If `--base` option is provided, use that
2. Otherwise, auto-detect the remote default branch:
   ```bash
   git remote show origin | grep 'HEAD branch' | sed 's/.*: //'
   ```
3. If auto-detect fails, fall back to `main`

Verify the resolved base branch exists: `git rev-parse --verify <base>`

### Step 3: Analyze changes

Run these commands in parallel:

```bash
git log <base>..HEAD --oneline
git diff <base>...HEAD --stat
git diff <base>...HEAD
```

- Read the full commit history since the branch diverged
- Understand the scope and nature of all changes
- Identify: new features, bug fixes, refactors, tests, docs, etc.

### Step 4: Generate PR content

**Title** (< 70 chars):
- Use conventional commit style prefix: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`

**Body:**

```markdown
## Summary
<1-3 bullet points describing the key changes>

## Changes
<detailed list of what was changed and why>

## Sequence Diagram
<mermaid sequence diagram showing the added or modified flows>

## Test plan
- [ ] <checklist of how to verify the changes>
```

**Sequence Diagram rules (MANDATORY):**
- **ALWAYS include a mermaid `sequenceDiagram`** — it is a required section of every PR body, never omitted.
- Use actual class/module names from the code as participants.
- Wrap it in a ```` ```mermaid ```` fenced block so GitHub renders it.
- Trace the request/data flow through the changed code: caller → changed components → external systems/responses.
- If the change is small or touches a single component, still draw the minimal flow (e.g. `User ->> Component: action` / `Component -->> User: result`). Never replace the diagram with prose.

### Step 5: Push and create PR

```bash
git push -u origin <current-branch>
gh pr create --title "<title>" --body "<body>"
```

Add `--draft` if flag given. Add `--base <branch>` if specified.

### Step 6: Report result

Show PR URL, title, and summary.

## Error handling

- `gh` not installed → `brew install gh`
- Not authenticated → `gh auth login`
- On main/master → refuse and ask to create a feature branch
