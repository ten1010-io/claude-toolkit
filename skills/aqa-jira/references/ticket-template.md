# Jira Ticket Draft Template

How to turn a single `status=fail` row from `results.csv` into a Jira ticket draft. The CSV schema is defined in `references/csv-contract.md` — this file only describes the **mapping** from a fail row to a Jira issue. Only `status=fail` rows are ever mapped; `pass` and `needs_discussion` rows are never ticketed.

## Inputs

Per fail row, the mapping reads:

- From `results.csv` (see `references/csv-contract.md`): `case_id`, `name`, `failure_reason`, `expected_vs_actual`, `evidence_path`, `tester`, `finished_at`, `jira_key`.
- From the run's `cases.yaml` (matched by `case_id`): the case `steps` (the natural-language step actions) and any `priority`.
- From the run's `summary.json` in the report dir (written by `aqa-inspect`): `engine`, `base_url`, `commit_hash`, `executed_at`. Per-case `tester` and `finished_at` come from the case's `results.csv` row (above), not from `summary.json`. The `report.html` path is the report dir's `report.html`.

If a row already has a non-empty `jira_key`, it was ticketed by a previous run — skip it and note the existing key (do not re-create).

## Field Mapping

| Jira field | Source | Notes |
|---|---|---|
| `summary` | `name` | Optionally prefix with `[AQA] ` for filterability, e.g. `[AQA] Login, wrong password`. Keep the prefix consistent across runs so dedup stays reliable. |
| `description` | composed (see below) | Markdown. `createJiraIssue` accepts `contentFormat: "markdown"`, so write the body as Markdown. Includes the evidence references inline. |
| `issuetype` | `--issue-type` argument | Default `Bug`. |
| `project` | `--project <KEY>` argument | — |

## `description` Body (Markdown)

Compose the description as **Markdown** (passed to `createJiraIssue` with `contentFormat: "markdown"`) from the fail row + cases.yaml steps + run metadata. Leave out any block whose source field is empty. Template:

```markdown
## Failure Reason
{failure_reason}

## Steps to Reproduce
1. {step 1 action from cases.yaml}
2. {step 2 action from cases.yaml}
3. ...

## Expected vs Actual
{expected_vs_actual}

## Evidence
- Screenshot: `{evidence_path}` (relative to the report dir, e.g. `artifacts/{case_id}/step-4.png`)
- Report: `{path to report.html}`

## Run Info
| Field | Value |
|---|---|
| Case ID | {case_id} |
| Engine | {engine} |
| Tester | {tester} |
| Finished at | {finished_at} |
| Base URL | {base_url} |
| Commit | {commit_hash} |
```

Notes:

- `Steps to Reproduce` comes from the matched `cases.yaml` case's `steps[].action`, in order.
- Mask any step marked `sensitive: true` as `****` (same rule as `aqa-run` / `aqa-inspect`).
- Omit a block entirely when its field is empty (e.g. no `commit_hash` → drop that table row; no `expected_vs_actual` → drop that heading; no `evidence_path` → drop the Screenshot line).

## Evidence (no binary attachment)

Binary file attachment is **not** supported by the current Atlassian MCP toolset; there is no upload/attachment tool. Instead, **reference the local evidence path and report.html inside the description** (see the `## Evidence` block above): embed the relative `evidence_path` (e.g. `artifacts/{case_id}/...png`) and the `report.html` path as text. A human can manually attach the screenshot to the ticket afterward if needed.

## Dedup Rule

Before creating a ticket, check for an existing open ticket for the same case. Run this JQL search against the target project:

```
project = {KEY} AND summary ~ "{name}" AND statusCategory != Done
```

- `{KEY}` = the `--project` value; `{name}` = the case `name` (the same text used for `summary`, including the `[AQA] ` prefix if you prefix summaries).
- **If a match exists →** this case is already ticketed. SKIP creation, treat it as a **duplicate**, and note the existing issue key (write it back into the row's `jira_key` if that column is empty). Do not create a second ticket.
- **If no match exists →** proceed to create the ticket.

The `statusCategory != Done` clause means a previously-fixed-and-closed ticket does NOT suppress a fresh ticket for a regression — only an open ticket dedups.
