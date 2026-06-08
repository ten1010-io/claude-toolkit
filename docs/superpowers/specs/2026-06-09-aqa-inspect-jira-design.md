# AQA Inspect + AQA Jira — Design

Date: 2026-06-09
Status: Approved design, pending spec review

## Overview

Two new, independent skills added to `claude-toolkit`. Existing `aqa-spec` and
`aqa-run` skills remain untouched.

- **`aqa-inspect`** — end-to-end batch: generate test cases (from Figma or by
  exploring a live URL), execute them with a selectable engine, fill per-case
  results, and produce an HTML report.
- **`aqa-jira`** — read the failures produced by `aqa-inspect` and create Jira
  tickets, gated by human approval.

The two skills are separated on purpose. An LLM may execute a test incorrectly,
so ticket creation is isolated behind a human review gate rather than being
chained automatically after execution.

The contract between the two skills is the `results.csv` schema. `aqa-inspect`
writes it; `aqa-jira` reads it.

## Skill A: `aqa-inspect`

### Purpose

One command takes a design source or live URL and produces executed,
result-tracked QA cases with an HTML report.

### Arguments

| Flag | Description |
|---|---|
| `--figma <url>` / `-f <url>` | Figma file/frame URL. Present → Figma generation mode. |
| `--target <url>` | Live service URL. Required when no Figma; saved as `BASE_URL`. |
| `--engine browser-use\|playwright` | Execution engine. Default `browser-use`. |
| `--tester <name>` | Tester name. If absent, asked once at start. |
| `--screenshot` | Capture before/after screenshots and embed in report. |
| `--headed` / `--headless` | Browser visibility. Default headed. |
| `--parallel N` | Concurrent cases. Default 2. |
| `--rerun-failed` / `--resume <reports_dir>` | Reuse an existing run: skip `pass`, re-run only `fail` and `needs_discussion`. |

### Mode dispatch (case generation)

- `--figma <url>` present → **Figma mode**: analyze the design, draft cases.
  Requires `--target` for the live URL to test against.
- Otherwise → **Explore mode**: visit `--target` live, inspect DOM /
  accessibility tree (and screenshots), auto-draft all cases.

Both modes emit `cases.yaml` using the existing AQA scenario schema (reused from
`aqa-spec`/`aqa-run`), so cases remain multi-step and structured.

### Execution engines (runtime branch)

Both engines consume the same `cases.yaml`.

- **`browser-use`** — same approach as existing `aqa-run`: natural-language
  steps driven by the browser-use CLI; screenshots as evidence. Requires the
  `browser-use` CLI (dependency check + install instructions reused from
  `aqa-run`).
- **`playwright`** — Node Playwright (`npx playwright`, v1.60.0 confirmed
  available). At runtime Claude reads the page DOM / accessibility tree and
  resolves each natural-language step into a concrete locator, then acts. No
  selectors are pre-baked into `cases.yaml`.

### Result determination

Per case, `status` ∈ `pass | fail | needs_discussion`.

- `pass` — all steps pass (or, for negative cases, the expected error shows).
- `fail` — a step fails / expected outcome not met.
- `needs_discussion` — assigned automatically when the LLM cannot confidently
  decide pass vs fail (ambiguous expected-vs-actual, undeterminable from
  DOM/screenshot). The reason is recorded in `discuss_note`.

### needs_discussion reclassification stage

After execution and before any Jira step, `aqa-inspect` surfaces every
`needs_discussion` case to the human, who reclassifies each to `pass` or `fail`.
Resolutions are written back into `results.csv`. This stage is skippable; any
remaining `needs_discussion` rows are simply excluded from `aqa-jira`.

### Outputs (`reports/{YYYY-MM-DD_HH-MM-SS}/`)

| File | Role |
|---|---|
| `cases.yaml` | Generated case definitions (multi-step, AQA schema). |
| `results.csv` | **Contract file** — one row per case. |
| `report.html` | Human report: meta header + summary + screenshots. |
| `artifacts/{case}/` | Screenshots/logs (only with `--screenshot`). |

#### `results.csv` columns

```
case_id, name, status, tester, finished_at, failure_reason,
expected_vs_actual, evidence_path, discuss_note, jira_key
```

- `case_id` — stable identifier (used for rerun matching and Jira dedup).
- `name` — case title (becomes Jira summary).
- `status` — `pass | fail | needs_discussion`.
- `tester` — from `--tester` or the start-of-run prompt.
- `finished_at` — case completion timestamp.
- `failure_reason` — populated when `status=fail`.
- `expected_vs_actual` — expected vs observed, for debugging.
- `evidence_path` — screenshot/log path.
- `discuss_note` — LLM note on why a case is ambiguous (for human reclassify).
- `jira_key` — written back by `aqa-jira` after ticket creation.

#### Environment / meta header

Recorded at the top of `report.html` (and the run summary) for reproducibility:
`executed_at`, `base_url`, `engine`, `browser`, `commit_hash`, and counts
(`total / passed / failed / needs_discussion`).

### File layout

```
skills/aqa-inspect/
  SKILL.md                  # dispatch + workflow overview
  references/
    generate-figma.md       # Figma → cases
    generate-explore.md     # live-URL exploration → cases
    engine-browser-use.md   # browser-use execution contract
    engine-playwright.md    # playwright runtime DOM-resolution contract
    results-csv.md          # results.csv schema (shared contract w/ aqa-jira)
    report-template.html    # HTML report template
```

## Skill B: `aqa-jira`

### Purpose

Turn `aqa-inspect` failures into Jira tickets, behind a human approval gate.

### Flow

1. Read `results.csv` from a given report dir; filter `status=fail` only
   (`pass` and `needs_discussion` excluded).
2. For each failure, draft a ticket:
   - `summary` = case name
   - `description` = failure_reason / steps / expected-vs-actual / run info
   - attach failure screenshot(s) and link the HTML report
3. Dedup: search existing tickets by matching summary (JQL); skip cases that
   already have a ticket.
4. **Human gate**: present the drafted ticket list; create only after approval.
5. Create via Atlassian MCP (`createJiraIssue` + attachment), then write the
   returned key back into `results.csv` `jira_key`.

### Arguments

| Flag | Description |
|---|---|
| `--results <path>` / `<reports_dir>` | Path to the `results.csv` (or its run dir). |
| `--project <KEY>` | Jira project key. Asked if absent. |
| `--issue-type <type>` | Issue type (e.g. Bug). Asked if absent. |

### File layout

```
skills/aqa-jira/
  SKILL.md                  # flow + Atlassian MCP call contract
  references/
    csv-contract.md         # results.csv schema (shared contract w/ aqa-inspect)
    ticket-template.md       # ticket body template
```

## Shared contract

`results.csv` is the single integration point. The schema lives in both
`skills/aqa-inspect/references/results-csv.md` and
`skills/aqa-jira/references/csv-contract.md`; changing one without the other
breaks the pipeline. Both docs must stay identical.

## Commands

Add `/aqa-inspect` and `/aqa-jira` under `commands/`, following the existing
`aqa-run.md` / `aqa-spec.md` command pattern, plus register both skills in the
plugin marketplace metadata.

## Out of scope (deferred)

- Flaky detection / repeated-run stability (`--retry N`).
- Priority-based filtering and a `priority` results column.

## Reused assets

- AQA scenario YAML schema and browser-use execution patterns from `aqa-run`.
- browser-use dependency check + install instructions from `aqa-run`.
- Atlassian MCP tools already connected in this environment (`createJiraIssue`,
  JQL search, attachment APIs).
