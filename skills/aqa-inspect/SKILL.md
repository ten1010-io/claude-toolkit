---
name: aqa-inspect
description: End-to-end AI QA — generate test cases (from a Figma design or by exploring a live URL), execute them with a selectable engine (browser-use screenshots or Playwright DOM), track per-case results (pass/fail/needs_discussion, tester, time, reasons) into results.csv, and emit an HTML report. Use whenever the user wants to inspect/QA a page or design end to end — "QA 돌려줘", "이 페이지 점검해줘", "피그마로 테스트 만들고 실행까지", "run full QA".
---

# AQA Inspect - End-to-End AI QA Orchestrator

Orchestrates the full QA loop in one command: **generate** test cases (from a Figma design or by exploring a live URL), **execute** them with a selectable engine, **track** per-case results into `results.csv`, and **render** an HTML report. Detailed mechanics are delegated to the files in `references/`; this document is the orchestration spine.

## Language

**CRITICAL:** You MUST detect the user's language from their messages and use that language for ALL interactions — status updates, questions, review prompts, error messages, result summaries, and reports. Do NOT use the English text written in this skill document as-is when communicating with the user. Translate into the user's language. The English in this document is only a reference for the AI.

## Arguments

| Flag | Default | Description |
|---|---|---|
| `--figma <url>` / `-f <url>` | — | Figma file or frame URL. If present, cases are generated from the design (see `references/generate-figma.md`). |
| `--target <url>` | — | Live service URL. Required when `--figma` is absent (exploration mode). Always stored as `BASE_URL` in every case. |
| `--engine browser-use\|playwright` | `browser-use` | Execution engine. `browser-use` = AI-interpreted screenshots; `playwright` = runtime DOM resolution. |
| `--tester <name>` | ask once | Who is running the QA. If omitted, ask once at the start and reuse for all rows. |
| `--screenshot` | off | Capture per-step screenshots into `artifacts/{case_id}/` and reference them as `evidence_path`. |
| `--headed` / `--headless` | `--headed` | Browser visibility. Headed shows a visible window. |
| `--parallel N` | `2` | Run up to N cases concurrently via a worker pool. `--parallel 1` runs sequentially. |
| `--rerun-failed` | off | Reuse the most recent report dir; skip `pass` rows, re-run only `fail` / `needs_discussion`. |
| `--resume <reports_dir>` | — | Reuse an explicit existing report dir; same skip-pass / re-run-unresolved behavior. |

## Workflow

Follow these steps **exactly**.

### 0. Resolve engine + dependency check

Read `--engine` (default `browser-use`). Then run the dependency check for the selected engine:

- `browser-use` → follow `references/engine-browser-use.md` ("Dependency Check + `BROWSER_USE_CMD`"). Store `BROWSER_USE_CMD`.
- `playwright` → follow `references/engine-playwright.md` ("Dependency Check"). Require Playwright v1.60.0+.

If the dependency check fails, print that engine's install message and **stop immediately**.

### 1. Tester

If `--tester <name>` was passed, use it. Otherwise ask the user **once** at the start ("Who is running this QA?") and reuse that value for every `results.csv` row's `tester` column.

### 2. Generate cases → `cases.yaml`

Decide the generation path from the arguments:

- If `--figma <url>` is present → follow `references/generate-figma.md`. (`--target <url>` is required there for `BASE_URL`; ask for it if missing.)
- Otherwise → require `--target <url>` and follow `references/generate-explore.md`. If `--target` is missing, ask for it before proceeding.

Both paths emit `cases.yaml` in the **AQA "Format A"** schema (the `cases:` structure documented in `skills/aqa-run/SKILL.md`) **plus a required `case_id` per case** — a stable lowercase slug like `login-001` (see `references/results-csv.md` and the `case_id` convention in the generation refs). The `case_id` is the join key for rerun-match and Jira dedup, so it must stay stable across regenerations.

**MANDATORY human review:** Show the full drafted `cases.yaml` to the user and pause for confirm / edit / cancel before any execution. Generation is lossy and can hallucinate selectors, validation messages, or flows. Do NOT auto-run drafted cases without explicit approval.

### 3. Create / reuse the report directory

- **Fresh run:** create `reports/{YYYY-MM-DD_HH-MM-SS}/`.
- **`--resume <dir>` or `--rerun-failed`:** reuse that directory (for `--rerun-failed`, the most recent `reports/*` dir). Read its existing `results.csv`, **skip** rows with `status=pass`, and re-run only rows with `status=fail` or `status=needs_discussion`. Update those rows in place; preserve untouched `pass` rows.

### 4. Execute via the selected engine

Delegate execution to the engine reference (`references/engine-browser-use.md` or `references/engine-playwright.md`). Both honor `--headed`/`--headless`, `--parallel N`, and `--screenshot`, and isolate each case (browser-use session per `case_id`; Playwright context per case).

Write/update `results.csv` exactly per `references/results-csv.md` (column order, RFC 4180 quoting, empty-field rules). The `tester` column is filled from Step 1, not invented by the engine.

Capture run metadata for the report:

- `base_url` — from `--target` / the cases' `BASE_URL`.
- `engine` — `browser-use` or `playwright`.
- `browser` — the browser used (e.g. Chromium headed/headless).
- `commit_hash` — `git rev-parse --short HEAD` if inside a git repo, else empty.
- `executed_at` — run start timestamp (ISO-8601).

### 5. `needs_discussion` reclassification stage

After execution, list **every** case with `status=needs_discussion` to the human, each with its `discuss_note`. For each, collect a human verdict of `pass` or `fail` and write the resolution back to `results.csv` (update `status`, and clear/fill `failure_reason` / `expected_vs_actual` accordingly).

This stage is **skippable** — if the user skips or leaves a case unresolved, it stays `needs_discussion` in `results.csv`.

### 6. Render `report.html`

Read `references/report-template.html` and render it to `report.html` in the report dir. The template uses **two token styles** — fill **both**:

- **Run-global tokens `{{UPPER}}`:** `{{META_EXECUTED_AT}}`, `{{META_BASE_URL}}`, `{{META_ENGINE}}`, `{{META_BROWSER}}`, `{{META_COMMIT_HASH}}`, `{{TOTAL}}`, `{{PASSED}}`, `{{FAILED}}`, `{{NEEDS_DISCUSSION}}`.
- **Per-case row tokens `{lower}`** (substituted once per `results.csv` row): `{case_name}`, `{status}`, `{STATUS}`, `{tester}`, `{finished_at}`, `{failure_reason}`, `{expected_vs_actual}`, `{discuss_note}`, `{evidence_path}`, `{case_id}`, `{jira_key}`.

### 7. Print summary

Print the totals and the report path:

```
====================================
AQA Inspect — Total {total} | Passed {passed} | Failed {failed} | Needs discussion {needs_discussion}
Report: reports/{timestamp}/report.html
====================================
```

## References

- `references/results-csv.md` — authoritative `results.csv` schema contract (columns, quoting, per-field meaning); shared with `aqa-jira`.
- `references/generate-figma.md` — generate `cases.yaml` from a `--figma <url>` design, with mandatory review.
- `references/generate-explore.md` — generate `cases.yaml` by exploring a live `--target <url>`, with mandatory review.
- `references/engine-browser-use.md` — browser-use engine contract: AI-interpreted session execution → `results.csv`.
- `references/engine-playwright.md` — Playwright engine contract: runtime DOM resolution via a per-run `run-case.mjs` driver → `results.csv`.
- `references/report-template.html` — HTML report template rendered in Step 6.

## Notes

- Mask any step marked `sensitive: true` as `****` in all logs, output, and the report.
- This skill **NEVER creates Jira tickets.** Ticket creation is the separate `aqa-jira` skill and runs only behind its own human gate. `aqa-inspect` leaves the `jira_key` column empty for `aqa-jira` to fill later.
- `priority` on a case is informational metadata only — `aqa-inspect` does not filter or select cases by priority.
- `case_id` slugs are stable across regenerations; never renumber or reuse a retired id.
