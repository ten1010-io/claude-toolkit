---
name: aqa-run
description: Run YAML-based QA test scenarios via browser-use CLI and generate HTML reports with screenshots. AI-driven browser automation that reads scenarios, executes steps, and produces summary.json + report.html. Use this skill whenever the user wants to run, execute, or test YAML scenario files — even if they just say "테스트 실행해줘", "run the test", "run this scenario", or give a path to a .yaml file.
---

# AQA Run - AI QA Automation Scenario Runner

Reads YAML scenario files and executes them via the browser-use CLI, then generates an HTML report and summary.json.

## Language

**CRITICAL:** You MUST detect the user's language from their messages and use that language for ALL interactions — status updates, error messages, result summaries, and reports. Do NOT use the English text written in this skill document as-is when communicating with the user. Translate into the user's language. The English in this document is only a reference for the AI.

## Trigger

Use when the user wants to run QA test scenarios, execute browser automation tests, or asks to run YAML scenario files.

## Arguments

- `<scenario_path>` — Path to a YAML scenario file (required). Single file or directory.
  - e.g.: `scenarios/auth/login_success.yaml`
  - e.g.: `scenarios/auth/` (runs all YAML files in the directory)
- `--headed` — Run with a visible browser window (default: headed)
- `--headless` — Run in headless mode
- `--screenshot` — Capture before/after screenshots for every step and embed them in the HTML report (default: off)
- `--parallel N` — Run N cases concurrently in separate browser sessions (default: 2). Use `--parallel 1` for sequential execution.

## Workflow

Follow the steps below **exactly**.

### 0. Dependency Check

Before starting, verify that the `browser-use` CLI is available. Search in this order:

#### Search Order

1. **Global install**: run `browser-use --help`
2. **Project venv**: run `.browser-use/bin/browser-use --help` (relative to project root)
3. **Home directory venv**: run `~/.browser-use/bin/browser-use --help`

- If any of the above succeeds → store that path as `BROWSER_USE_CMD` and proceed
- If all fail → print the message below and **stop immediately**:

```
[ERROR] browser-use CLI is not installed.
Please install it using one of the methods below (uv venv recommended):

  # Per-project install (current directory)
  uv venv .browser-use --python 3.12
  uv pip install browser-use --python .browser-use/bin/python

  # Or global install (home directory)
  uv venv ~/.browser-use --python 3.12
  uv pip install browser-use --python ~/.browser-use/bin/python

Please try again after installation.
```

#### Using `BROWSER_USE_CMD`

All subsequent `browser-use` commands must use the path stored in `BROWSER_USE_CMD`:
- Global install: `browser-use open "..."`
- venv install: `.browser-use/bin/browser-use open "..."` or `~/.browser-use/bin/browser-use open "..."`

### 1. Parse YAML Scenario

Read the YAML file using the Read tool and determine its structure. **Two formats** are supported:

#### Format A: Cases Structure (multiple cases in one file)

```yaml
name: "Feature Name"
description: "Description"
tags: [tag1, tag2]

cases:
  - name: "Case Name"
    priority: critical|high|medium|low
    expected_result: "pass|fail"
    test_data:
      username: "value"
      password: "value"
    steps:
      - action: "Natural language action description"
    cleanup:
      - type: clear_cookies
```

#### Format B: Single Scenario Structure (legacy compatible)

```yaml
name: "Scenario Name"
description: "Description"
priority: critical|high|medium|low
tags: [tag1, tag2]
test_data:
  username: "value"
  password: "value"
depends_on: []
steps:
  - action: "Natural language action description"
cleanup:
  - type: clear_cookies
```

#### Format Detection Rules

- If the YAML has a `cases` key → **Format A**
- If no `cases` key → **Format B** (convert to Format A internally)

**Variable Substitution Rules:**

All key-value pairs in each case's `test_data` are substituted as `${key}` in that case's action strings.

If `test_data` does not contain `BASE_URL` and `.env` has `TARGET_BASE_URL`, use that. If neither exists, ask the user.

### 3. Create Report Directory

```
reports/{YYYY-MM-DD_HH-MM-SS}/
  artifacts/{feature_name_case_name}/    ← only if --screenshot enabled
  summary.json
  report.html
```

### 4. Execute Scenarios

Execute cases in parallel using the Agent tool. The `--parallel N` argument controls concurrency (default: 2).

Each Agent runs its case in an independent browser session using `--session case_{index}`.

#### Parallel Execution: Worker Pool Pattern

Use `run_in_background: true` for Agent calls:

1. Launch up to N background Agents for the first N cases
2. As soon as any single Agent completes, immediately launch the next pending case
3. Repeat until all cases are done
4. Collect all results

#### 4-1. Open Browser

```bash
{BROWSER_USE_CMD} --session case_{index} --headed open "{URL}"
```

#### 4-2. Handle SSL Certificate Warnings

If `browser-use state` output contains "Your connection is not private" or "ERR_CERT":
1. Click "Advanced" → click "Proceed to (unsafe)"

#### 4-3. Execute Each Step

For each step:
1. Save Before screenshot (only if `--screenshot`)
2. Interpret `action` and execute appropriate browser-use commands:
   - Navigation → `browser-use open "{URL}"`
   - Input → `browser-use state` → `browser-use input {index} "{value}"`
   - Click → `browser-use state` → `browser-use click {index}`
   - Verification → check via `browser-use state`, retry with `browser-use eval "document.body.innerText"`
3. Save After screenshot (only if `--screenshot`)
4. Record step result: index, action, status, method, locator, assertions, error, screenshots

#### 4-4. Determine Result Based on expected_result

- **`expected_result: "pass"`**: all steps pass → PASS, any fail → FAIL
- **`expected_result: "fail"`**: error message shown correctly → PASS, no error shown → FAIL

#### 4-5. Cleanup

```bash
{BROWSER_USE_CMD} --session case_{index} cookies clear
{BROWSER_USE_CMD} --session case_{index} close
```

### 5. Generate summary.json

```json
{
  "executed_at": "{timestamp}",
  "mode": "claude-browser-use",
  "feature": "Feature Name",
  "total": 5,
  "passed": 4,
  "failed": 1,
  "errors": 0,
  "cases": [ ... ]
}
```

### 6. Generate HTML Report

Read the template from `references/report-template.html` (relative to this SKILL.md), fill placeholders, save as `report.html`.

### 7. Output Results

```
====================================
{Feature Name} — Total {total} | Passed {passed} | Failed {failed} | Errors {errors}
Report: reports/{timestamp}/report.html
====================================
```

## References

- `references/report-template.html` — HTML report template used in Step 6.

## Notes

- Mask `sensitive: true` step values as `****` in output.
- Always use `BROWSER_USE_CMD` path detected in Step 0.
- uv venv + Python 3.12 recommended to avoid Python 3.14 compatibility issues.
