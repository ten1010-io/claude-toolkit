---
name: aqa-inspect
description: End-to-end AI QA — generate test cases (from a Figma design or by exploring a live URL), execute them with a selectable engine (browser-use screenshots or Playwright DOM), track per-case results (pass/fail/needs_discussion, tester, time, reasons) into results.csv, and emit an HTML report. Use whenever the user wants to inspect/QA a page or design end to end — "QA 돌려줘", "이 페이지 점검해줘", "피그마로 테스트 만들고 실행까지", "run full QA".
---

# AQA Inspect - End-to-End AI QA Orchestrator

Orchestrates the full QA loop in one command: **generate** test cases (from a Figma design or by exploring a live URL), **execute** them with a selectable engine, **track** per-case results into `results.csv`, and **render** an HTML report. A **playwright** run additionally emits `cases.compiled.yaml` — a deterministic, LLM-free IR of the passing cases for offline re-execution by [`aqa-runner`](https://github.com/ten1010-io/aqa-runner). Detailed mechanics are delegated to the files in `references/`; this document is the orchestration spine.

## Language

**CRITICAL:** You MUST detect the user's language from their messages and use that language for ALL interactions — status updates, questions, review prompts, error messages, result summaries, and reports. Do NOT use the English text written in this skill document as-is when communicating with the user. Translate into the user's language. The English in this document is only a reference for the AI.

This extends to **generated artifacts**: write each `cases.yaml` case `name` and every `steps[].action` in the user's detected language too (not just chat messages). There is no fixed default language — always mirror whatever language the user is speaking. Only machine-stable tokens stay in English/ASCII: `case_id` slugs, YAML keys, and `expected_result` values (`pass`/`fail`).

## Arguments

| Flag | Default | Description |
|---|---|---|
| `--figma <url>` / `-f <url>` | — | Figma file or frame URL. If present, cases are generated from the design (see `references/generate-figma.md`). A `node-id` in the URL is an entry point only — the full file structure is enumerated and the scope is confirmed with the user. |
| `--figma-token <token>` | env / ask | Figma Personal Access Token. Falls back to `FIGMA_ACCESS_TOKEN` (.env / shell env), then asks the user. Required whenever `--figma` is used. |
| `--target <url>` | — | Live service URL. Required when both `--figma` and `--cases` are absent (exploration mode). Always stored as `BASE_URL` in every case. |
| `--cases <path>` | — | Execute an existing `cases.yaml` directly, skipping generation. The file must conform to `references/cases-yaml.md` (including a `case_id` per case). The drafted-case human review gate is skipped for user-provided files. |
| `--engine browser-use\|playwright` | ask | Execution engine. `browser-use` = AI-interpreted screenshots; `playwright` = runtime DOM resolution. If omitted, the user is asked to pick one at the start (Step 0). |
| `--tester <name>` | ask once | Who is running the QA. If omitted, ask once at the start and reuse for all rows. |
| `--auth-email <v>` | env / ask | Login account email/ID for targets behind authentication. Falls back to `QA_AUTH_EMAIL` (.env / shell env), then asks — only when the user says the target requires login (Step 1.5). |
| `--auth-password <v>` | env / ask | Login account password. Falls back to `QA_AUTH_PASSWORD` (.env / shell env), then asks. Plaintext chat input is acceptable; the value is masked as `****` in all logs, output, and reports via the `sensitive: true` mechanism. |
| `--screenshot` | off | **Full capture mode**: per-step screenshots for every case into `artifacts/{case_id}/`. Even **without** this flag, a screenshot is always captured at the moment a case fails (or lands in `needs_discussion`) — failure evidence is mandatory, not optional. The flag only adds per-step shots for passing cases too. |
| `--headed` / `--headless` | `--headed` | Browser visibility. Headed shows a visible window. |
| `--parallel N` | `2` | Run up to N cases concurrently via a worker pool. `--parallel 1` runs sequentially. |
| `--rerun-failed` | off / auto-ask | Reuse the most recent report dir; skip `pass` rows, re-run only `fail` / `needs_discussion`. Even without the flag, if the latest report dir has unresolved rows the user is asked whether to re-run them (Step 0.5). |
| `--resume <reports_dir>` | — | Reuse an explicit existing report dir; same skip-pass / re-run-unresolved behavior. |

## Workflow

Follow these steps **exactly**.

### Question batching rule

Interrupt the user at most **twice** at the start. Collect every applicable start-of-run question into batched AskUserQuestion calls (max 4 questions per call); each question is skipped individually when its flag/env already supplies the value:

- **Round 1 (always at most one call):** engine (Step 0) · tester (Step 1) · rerun offer (Step 0.5) · "does the target require login?" (Step 1.5).
- **Round 2 (conditional follow-up, only if needed):** auth email · auth password (Step 1.5, when login = yes) · Figma token · target URL (Figma path, see `generate-figma.md`).

A run with all values supplied via flags/env asks **zero** questions.

### 0. Resolve engine + dependency check

Read `--engine`. **If the flag was not passed, do NOT silently default — ask the user which engine to use** (via AskUserQuestion where available), presenting both options with a one-line tradeoff each:

- `browser-use` (recommended default) — AI-interpreted screenshots; resilient to selector changes, slower per step.
- `playwright` — runtime DOM resolution; fast and deterministic, requires Playwright v1.60.0+.

Then run the dependency check for the selected engine:

- `browser-use` → follow `references/engine-browser-use.md` ("Dependency Check + `BROWSER_USE_CMD`"). Store `BROWSER_USE_CMD`.
- `playwright` → follow `references/engine-playwright.md` ("Dependency Check"). Require Playwright v1.60.0+.

If the dependency check fails, print that engine's install message and **stop immediately**.

### 0.5. Rerun auto-detect

Runs only when **none** of `--rerun-failed`, `--resume`, or `--cases` was passed.

Find the most recent `reports/{timestamp}/` directory (lexically-largest name). If it exists and its `results.csv` contains any row with `status=fail` or `status=needs_discussion`, ask the user before starting a fresh run:

> "The last run ({timestamp}) has {N} unresolved case(s) ({fail} fail / {needs_discussion} needs discussion). Re-run only those, or start a fresh run?"

- **Re-run** → proceed exactly as if `--rerun-failed` had been passed (Step 2 is skipped, Step 3 reuses that dir).
- **Fresh** → continue normally.

If no previous report dir exists, or its `results.csv` has no unresolved rows, skip this question silently.

This question goes into Round 1 of the question batching rule above.

### 1. Tester

If `--tester <name>` was passed, use it. Otherwise ask the user **once** at the start ("Who is running this QA?", Round 1) and reuse that value for every `results.csv` row's `tester` column.

### 1.5. Authentication requirement + credentials

Runs only in **generation modes** (`--figma` / `--target` exploration). **Skip entirely for `--cases`** — user-authored files already carry credentials in `test_data`.

1. Ask in Round 1: **"Does the target page require login?"** (yes / no).
2. **No** → do not ask anything about credentials. Done.
3. **Yes** → resolve the account in this priority order, asking (Round 2) only for what is still missing:
   1. `--auth-email` / `--auth-password` flags.
   2. `QA_AUTH_EMAIL` / `QA_AUTH_PASSWORD` from `.env` / `.env.local` / shell env.
   3. Ask the user. Plaintext password input in chat is acceptable.

Hand the resolved credentials to the generation step (Step 2): the generation refs perform the login flow before exploring, inject the credentials into every generated case's `test_data`, prepend the login steps, and mark password-input steps `sensitive: true`. The password is masked as `****` in all logs, output, `cases.yaml` review display, and reports.

**Login-wall fallback:** if the user answered "no" (or wasn't asked) but exploration hits a login wall — a redirect to a login path or a password field blocking the flow — pause and ask for credentials at that point, then continue.

### 2. Generate cases → `cases.yaml`

**Coverage mandate (generation paths):** maximize the number of cases — **time is not a constraint, coverage is the goal.** Enumerate the *whole* surface (every route/page, list+detail, form, dialog, tab) and decompose each into many field-, control-, state-, and negative-level cases. Three categories MUST each be exhausted, not sampled:

- **Every field** — one case (or more, with negatives) per input/select/checkbox/radio/textarea/toggle/date-picker. Never collapse a form into a single "fill the form" case.
- **Every popup / overlay** — each modal, dialog, drawer, confirm/alert popup, tooltip, toast, dropdown menu, context menu, and popover gets its own case: trigger it open, verify its content, then close/confirm/cancel it (close path is a separate case).
- **Every action / interaction type** — each button, link, tab, sort, filter, hover, drag, expand/collapse, copy, upload/download, submit, and keyboard interaction gets its own case.

Plus: render checks per column/section, search/no-match/filter/sort, pagination, full CRUD as separate C/R/U/D cases, boundary + negative inputs, auth/session/security, cross-cutting nav. A thorough sheet is typically dozens to 100+ cases — never stop at a handful of happy paths. On shared/production targets, preserve coverage safely via throwaway resources or presence-only checks for destructive controls. Full rules: `generate-explore.md` Step 3 / `generate-figma.md` Step 2.

**On `--rerun-failed` / `--resume`, SKIP this entire step — including the human-review gate.** Reuse the existing `cases.yaml` from the report dir **as-is**; do NOT regenerate. Regenerating would change `case_id`s and break the rerun match against the existing `results.csv`. Jump straight to Step 3.

Otherwise (fresh run), decide the path from the arguments:

- If `--cases <path>` is present → **skip generation entirely.** Load the given file, validate it against the schema in `references/cases-yaml.md` (top-level `cases:` list; every case carries a `case_id`, `name`, `expected_result`, `test_data` with `BASE_URL`, and `steps`). If validation fails, report the problems and stop. The human review gate below is **skipped** — the file was authored by the user, not drafted by the AI. Go straight to Step 3.
- If `--figma <url>` is present → follow `references/generate-figma.md`. (`--target <url>` is required there for `BASE_URL`; ask for it if missing — Round 2 question.)
- Otherwise → require `--target <url>` and follow `references/generate-explore.md`. If `--target` is missing, ask for it before proceeding.

In both generation paths, pass the Step 1.5 auth outcome through: when login is required, authenticate before exploring/verifying, inject credentials into `test_data`, and prepend login steps to generated cases (details in each generation ref).

Both generation paths emit `cases.yaml` in the schema defined in `references/cases-yaml.md`, including a required `case_id` per case — a stable lowercase slug like `login-001` (see `references/results-csv.md` and the `case_id` convention in the generation refs). The `case_id` is the join key for rerun-match and Jira dedup, so it must stay stable across regenerations.

**MANDATORY human review (generated cases only):** Show the full drafted `cases.yaml` to the user and pause for confirm / edit / cancel before any execution. Generation is lossy and can hallucinate selectors, validation messages, or flows. Do NOT auto-run drafted cases without explicit approval. (Not applicable to `--cases` — user-provided files are already human-authored.)

### 3. Create / reuse the report directory

- **Fresh run:** create `reports/{YYYY-MM-DD_HH-MM-SS}/`.
- **`--resume <dir>`:** reuse the given directory.
- **`--rerun-failed`:** reuse the **most recent** report dir — the latest `reports/{timestamp}/` by directory name (the `YYYY-MM-DD_HH-MM-SS` timestamp sorts lexically, so the lexically-largest name is the newest).

The report dir holds these outputs:

```
reports/{YYYY-MM-DD_HH-MM-SS}/
  artifacts/{case_id}/    ← only if --screenshot enabled
  results.csv             ← per-case rows (see references/results-csv.md)
  summary.json            ← run metadata + counts (written in Step 6)
  report.html             ← rendered report (Step 6)
  cases.compiled.yaml     ← playwright engine only — offline IR for aqa-runner (Step 4, see references/compile-ir.md)
```

In both reuse modes: read the existing `cases.yaml` and `results.csv` from that dir, **skip** rows with `status=pass`, and re-run only rows with `status=fail` or `status=needs_discussion`. **Match each re-run case to its existing `results.csv` row by `case_id`; update that row IN PLACE, never append a duplicate.** Preserve untouched `pass` rows.

### 4. Execute via the selected engine

Delegate execution to the engine reference (`references/engine-browser-use.md` or `references/engine-playwright.md`). Both honor `--headed`/`--headless`, `--parallel N`, and `--screenshot`, and isolate each case (browser-use session per `case_id`; Playwright context per case).

**Failure-moment evidence (both engines, regardless of `--screenshot`):** when a case fails or ends `needs_discussion`, capture a screenshot of the page state at that moment into `artifacts/{case_id}/` and set it as `evidence_path`. Passing cases get screenshots only in `--screenshot` full-capture mode — so default runs stay fast.

Write/update `results.csv` exactly per `references/results-csv.md` (column order, RFC 4180 quoting, empty-field rules). The `tester` column is filled from Step 1, not invented by the engine.

**Selector cache persistence (single writer).** Each engine returns a per-case
`resolved_selectors` array (see the engine refs). The orchestrator — never the
parallel workers — merges these into `cases.yaml` as each case completes:

- For each entry, write `selector` (and `selector_anchor` from `anchor`) into the
  matching `steps[step]` of that `case_id`. This makes the cache available to the
  next rerun/resume of this report dir.
- When an entry has `changed: true`, append a drift record to
  `reports/{ts}/selector-drift.json`:
  `{ "case_id", "step", "old", "new": <selector> }`. A first-time fill
  (`changed: false`) is **not** drift and is not recorded.
- Because the single-threaded orchestrator is the only writer, `--parallel N`
  causes no `cases.yaml` write race.

**IR compile output — `cases.compiled.yaml` (playwright engine only).** The
playwright engine also returns a per-case `compiled_steps` array (see
`engine-playwright.md`). The orchestrator — the single writer — assembles these
into `reports/{ts}/cases.compiled.yaml`, the deterministic offline IR consumed
by [`aqa-runner`](https://github.com/ten1010-io/aqa-runner). Full rules:
`references/compile-ir.md`. In short:

- Include **only** cases whose `status=pass`; skip `fail` / `needs_discussion`
  (no trustworthy structured form).
- Emit `ir_version: 1`, copy `name` / `description` from `cases.yaml`, and for
  each passing case emit `case_id`, `name`, `expected_result`, the case's
  `compiled_steps` as `steps`, and `cleanup` copied from the source case.
- **Masking:** never write a secret value — sensitive steps carry `value_ref`
  only (the `test_data` key), never the literal, same as the `****` rule.
- **browser-use runs do NOT write this file** — that engine returns no
  `compiled_steps`.
- **`--rerun-failed` / `--resume`:** regenerate the file from the **union** of
  all currently-passing cases in the report dir (previously-passing + newly
  passing), keyed by `case_id`, so the IR reflects every green case.

Capture run metadata for the report:

- `base_url` — from `--target` / the cases' `BASE_URL`.
- `engine` — `browser-use` or `playwright`.
- `browser` — the browser used (e.g. Chromium headed/headless).
- `commit_hash` — `git rev-parse --short HEAD` if inside a git repo, else empty.
- `executed_at` — run start timestamp (ISO-8601), taken right before the first case starts.
- `finished_at` — run end timestamp (ISO-8601), taken right after the last case finishes.
- `duration_seconds` — `finished_at - executed_at` in whole seconds.

### 5. `needs_discussion` reclassification stage

After execution, list **every** case with `status=needs_discussion` to the human, each with its `discuss_note`. For each, collect a human verdict of `pass` or `fail` and write the resolution back to `results.csv` (update `status`, and clear/fill `failure_reason` / `expected_vs_actual` accordingly).

This stage is **skippable** — if the user skips or leaves a case unresolved, it stays `needs_discussion` in `results.csv`.

### 6. Write `summary.json` + render `report.html`

First write `summary.json` to the report dir, capturing the run metadata (from Step 4) and the final counts from `results.csv` (after the Step 5 reclassification). This is the machine-readable run meta that `aqa-jira` reads; `report.html` is for humans only. Shape:

```json
{
  "executed_at": "{ISO-8601 run start}",
  "finished_at": "{ISO-8601 run end}",
  "duration_seconds": N,
  "engine": "browser-use|playwright",
  "base_url": "{base_url}",
  "browser": "{browser used, e.g. Chromium headed}",
  "commit_hash": "{git rev-parse --short HEAD, or empty}",
  "tester": "{tester from Step 1}",
  "total": N,
  "passed": N,
  "failed": N,
  "needs_discussion": N
}
```

If `selector-drift.json` exists in the report dir, surface each record as a
per-case "selector drift" badge in the report (token `{selector_drift}`,
rendered only when present — see `report-template.html`). Match each drift
record to its case by `case_id`. When a case has multiple drifted steps, render
one `step N: <old> → <new>` line per matching record and join them (e.g. with
`<br>`) into the single `{selector_drift}` value. When a case has no drift
record, leave `{selector_drift}` empty so its `<!-- IF-selector_drift -->`
section is omitted, consistent with the other IF-conditionals. `summary.json`
and `results.csv` are NOT modified for drift.

Then read `references/report-template.html` and render it to `report.html` in the report dir. The template uses **two token styles** — fill **both**:

- **Run-global tokens `{{UPPER}}`:** `{{META_EXECUTED_AT}}`, `{{META_FINISHED_AT}}`, `{{META_DURATION}}`, `{{META_BASE_URL}}`, `{{META_ENGINE}}`, `{{META_BROWSER}}`, `{{META_COMMIT_HASH}}`, `{{TOTAL}}`, `{{PASSED}}`, `{{FAILED}}`, `{{NEEDS_DISCUSSION}}`. `{{META_DURATION}}` is human-readable, built from `duration_seconds` — `1h 12m 34s` / `12m 34s` / `34s` (omit leading zero units).
- **Per-case row tokens `{lower}`** (substituted once per `results.csv` row): `{case_name}`, `{status}`, `{STATUS}`, `{tester}`, `{finished_at}`, `{failure_reason}`, `{expected_vs_actual}`, `{discuss_note}`, `{evidence_path}`, `{case_id}`, `{jira_key}`, `{selector_drift}` (sourced from `selector-drift.json`, not a results.csv column; see Step 6).

**Repeat and conditional markers.** The per-case block is delimited by `<!-- BEGIN-CASE -->` / `<!-- END-CASE -->` — repeat that whole block once per `results.csv` row, in order. Conditional sections inside it are wrapped in `<!-- IF-{field} -->` / `<!-- ENDIF-{field} -->` pairs: include a section ONLY when its field is non-empty, otherwise OMIT the whole section — do NOT emit an empty "Failure Reason" / "Discussion Note" section or a broken `<img src="">`. `evidence_path` is a relative path under `artifacts/{case_id}/`, which resolves against the report dir for both engines.

**Strip template-machinery comments from the shipped report.** The template's renderer-contract comment and the `BEGIN-CASE` / `IF-*` markers are instructions to the renderer, not report content — remove all HTML comments from the rendered output. This is also required for validation to work: the contract comment contains literal `{{TOKEN}}` / `{token}` sample text and an unmatched `<div class="case">` example, which false-positive every check below if left in.

**Validate before shipping the report (mandatory).** After rendering (and comment-stripping), check: (a) `<div>` open/close counts are equal, (b) no `{{TOKEN}}` or unfilled `{token}` placeholders remain, (c) the count of `<div class="case">` equals the number of result rows. A truncated case block leaves divs unclosed, which nests every subsequent case one level deeper and renders the report as an unreadable staircase. If any check fails, fix the renderer and regenerate — never deliver an unvalidated report.

### 7. Print summary

Print the totals and the report path:

```
====================================
AQA Inspect — Total {total} | Passed {passed} | Failed {failed} | Needs discussion {needs_discussion}
Report: reports/{timestamp}/report.html
====================================
```

## References

- `references/cases-yaml.md` — authoritative `cases.yaml` schema (file/case/step fields, `case_id` requirement, variable substitution rules).
- `references/results-csv.md` — authoritative `results.csv` schema contract (columns, quoting, per-field meaning); shared with `aqa-jira`.
- `references/generate-figma.md` — generate `cases.yaml` from a `--figma <url>` design, with mandatory review.
- `references/generate-explore.md` — generate `cases.yaml` by exploring a live `--target <url>`, with mandatory review.
- `references/engine-browser-use.md` — browser-use engine contract: AI-interpreted session execution → `results.csv`.
- `references/engine-playwright.md` — Playwright engine contract: runtime DOM resolution via a per-run `run-case.mjs` driver → `results.csv` + `compiled_steps`.
- `references/compile-ir.md` — how a playwright run emits `cases.compiled.yaml` (IR v1) for offline execution by `aqa-runner`.
- `references/report-template.html` — HTML report template rendered in Step 6.

## Outputs

Each run writes into `reports/{YYYY-MM-DD_HH-MM-SS}/`:

- `results.csv` — per-case rows (schema in `references/results-csv.md`).
- `summary.json` — machine-readable run metadata + counts (`executed_at`, `finished_at`, `duration_seconds`, `engine`, `base_url`, `browser`, `commit_hash`, `tester`, `total`, `passed`, `failed`, `needs_discussion`). This is what `aqa-jira` reads for run metadata.
- `report.html` — human-facing rendered report.
- `selector-drift.json` — present only when a cached selector was re-resolved
  differently during the run; drives the report's drift badges. Not read by
  `aqa-jira`.
- `cases.compiled.yaml` — **playwright engine only.** The deterministic, LLM-free
  IR (v1) of every passing case — hand this to
  [`aqa-runner`](https://github.com/ten1010-io/aqa-runner) to re-run the suite
  offline (e.g. in an air-gapped network). Not written for browser-use runs and
  not read by `aqa-jira`. See `references/compile-ir.md`.
- `artifacts/{case_id}/` — per-step screenshots (only with `--screenshot`).

## Notes

- Mask any step marked `sensitive: true` as `****` in all logs, output, and the report.
- This skill **NEVER creates Jira tickets.** Ticket creation is the separate `aqa-jira` skill and runs only behind its own human gate. `aqa-inspect` leaves the `jira_key` column empty for `aqa-jira` to fill later.
- `priority` on a case is informational metadata only — `aqa-inspect` does not filter or select cases by priority.
- `case_id` slugs are stable across regenerations; never renumber or reuse a retired id.
- The per-step `selector` cache in `cases.yaml` survives `--rerun-failed` /
  `--resume` (same report dir) and makes those runs fast. A fresh run regenerates
  `cases.yaml` and re-harvests selectors. Field schema: `references/cases-yaml.md`.
