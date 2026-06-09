---
name: aqa-jira
description: Read aqa-inspect results.csv and create Jira tickets for failed test cases, behind a human approval gate. Filters status=fail only (pass and needs_discussion excluded), drafts tickets with failure details + screenshots, dedups against existing tickets, and writes the created ticket key back into results.csv. Use when the user says "실패한 테스트 지라에 올려줘", "create Jira tickets from QA results", "티켓 생성해줘".
---

# AQA Jira - Human-Gated Ticket Creation from QA Results

Reads the `results.csv` produced by `aqa-inspect`, filters to **failed** cases only, drafts a Jira ticket per failure (with failure details + screenshots), dedups against existing tickets, and — only after explicit human approval — creates the tickets and writes each returned key back into `results.csv`. This skill **NEVER runs tests**; it only turns recorded failures into tickets.

## Language

**CRITICAL:** You MUST detect the user's language from their messages and use that language for ALL interactions — status updates, questions, the approval prompt, error messages, and summaries. Do NOT use the English text written in this skill document as-is when communicating with the user. Translate into the user's language. The English in this document is only a reference for the AI.

## Arguments

| Flag | Default | Description |
|---|---|---|
| `--results <path>` | — | Path to the `results.csv` to read. |
| `<reports_dir>` (positional) | — | A report directory; locate `results.csv` inside it. Use this OR `--results`. |
| `--project <KEY>` | ask | Target Jira project key (e.g. `PROJ`). If absent, ask the user before drafting. |
| `--issue-type <type>` | `Bug` (ask) | Jira issue type. If absent, ask the user; default to `Bug` if they have no preference. |

If neither `--results` nor a positional `<reports_dir>` is given, ask the user which results to read.

## Why this is separate from aqa-inspect

An LLM can misjudge a test — a "failure" may be a flaky run, a test-data issue, or a spec ambiguity rather than a real defect. So ticket creation is deliberately **gated by human review** and split out of `aqa-inspect`. `aqa-inspect` only records results into `results.csv` and leaves `jira_key` empty; this skill is the only place tickets are created, and it does so only after a human approves. **This skill NEVER runs tests** and never modifies test results other than writing the `jira_key` of a created/deduped ticket.

## Workflow

Follow these steps **exactly**.

### 1. Read `results.csv` and filter to failures

Locate `results.csv` from `--results <path>` or the positional `<reports_dir>`. Parse it per the schema in `references/csv-contract.md` (column order, RFC 4180 quoting, empty-field rules).

**Filter to `status=fail` ONLY.** `pass` and `needs_discussion` rows are NEVER ticketed — skip them silently. If there are no `fail` rows, report that there is nothing to ticket and **stop**.

### 2. Build a draft per failure

For each `fail` row, build a Jira ticket draft following `references/ticket-template.md` (summary, Jira-markup description with failure_reason + cases.yaml steps + expected_vs_actual + run info, and the `evidence_path` screenshot attachment).

### 3. Dedup against existing tickets

For each draft, run the dedup JQL from `references/ticket-template.md`:

```
project = {KEY} AND summary ~ "{name}" AND statusCategory != Done
```

Use the Atlassian MCP JQL search tool (`searchJiraIssuesUsingJql`). If an open match exists, mark the case as **skip** and capture the existing issue key. A row that already has a non-empty `jira_key` is also a skip. Otherwise mark the case as **new**.

### 4. HUMAN GATE (mandatory)

Present the full draft list to the user **before creating anything**: for each failure show its `summary` and whether it is **new** (will be created) or **skipped** (already ticketed — show the existing key). Then ask for **explicit approval** to proceed. Do NOT create, attach, or modify anything in Jira until the user explicitly approves. If the user declines or edits the list, honor that and re-confirm.

### 5. On approval, create + attach + write back

For each **new** draft, in order:

1. Create the issue via the Atlassian MCP `createJiraIssue` tool (project = `--project`, issuetype = `--issue-type`, summary + description from the draft).
2. If the row has an `evidence_path`, attach the screenshot(s) to the created issue via the Atlassian MCP attachment tool.
3. Write the returned issue key into that row's `jira_key` column in `results.csv` and **save** the file (preserve all other rows and columns exactly; re-quote per the contract).

For **skipped** rows where `jira_key` was empty, write the deduped existing key back into `jira_key` as well.

### 6. Print summary

Report created vs skipped counts with ticket links:

```
====================================
AQA Jira — Created {created} | Skipped {skipped} (already ticketed)
Created: PROJ-123 (<summary>), PROJ-124 (<summary>), ...
Skipped: PROJ-100 (<summary>), ...
====================================
```

## MCP Contract

This skill uses the connected **Atlassian MCP** tools. Their schemas are not loaded up front — load them on demand at runtime via `ToolSearch` (e.g. `select:mcp__...__createJiraIssue`) before calling:

- **`createJiraIssue`** — create each ticket (Step 5).
- **`searchJiraIssuesUsingJql`** — run the dedup JQL search (Step 3).
- The Atlassian **attachment** tool — attach `evidence_path` screenshots to a created issue (Step 5).

The skill only **documents** these tools; it does not call them outside the workflow above, and never before the human gate in Step 4.

## References

- `references/csv-contract.md` — authoritative `results.csv` schema (byte-identical copy of `aqa-inspect`'s contract); the input this skill reads and writes `jira_key` back into.
- `references/ticket-template.md` — fail-row → Jira ticket mapping (summary, description body, attachment) and the dedup JQL rule.

## Notes

- **NEVER create tickets without explicit human approval** (Step 4). The gate is mandatory.
- `pass` and `needs_discussion` rows are NEVER ticketed — only `status=fail`.
- This skill NEVER runs tests; it only reads `results.csv` and writes back `jira_key`.
- Mask any `sensitive: true` step value as `****` in drafts and tickets.
