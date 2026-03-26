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
    expected_result: "pass|fail"        # "fail" means an error is expected
    test_data:
      username: "value"
      password: "value"
    steps:
      - action: "Natural language action description"
    cleanup:
      - type: clear_cookies

  - name: "Error Case Name"
    priority: high
    expected_result: "fail"
    test_data:
      username: "wrong_user"
      password: "wrong_pass"
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

- If the YAML has a `cases` key → **Format A** (cases structure)
- If no `cases` key → **Format B** (single scenario, legacy compatible)
- Format B is internally converted to Format A with one case:
  ```
  Format B → cases: [{ name: yaml.name, priority: yaml.priority, expected_result: "pass", test_data: yaml.test_data, steps: yaml.steps, cleanup: yaml.cleanup }]
  ```

**Variable Substitution Rules:**

All key-value pairs in each case's `test_data` are substituted as `${key}` in that case's action strings.
- `${BASE_URL}` → test_data.BASE_URL value
- `${username}` → test_data.username value
- `${password}` → test_data.password value

If `test_data` does not contain `BASE_URL` and `.env` or `.env.example` has `TARGET_BASE_URL`, use that as `${BASE_URL}`. If neither exists, ask the user.

**`action` Field Rules:**

`action` is a natural language sentence. Claude reads it and determines the appropriate browser-use commands. It may contain variables (`${...}`).

Examples:
- `"Navigate to ${BASE_URL}/welcome"` → `browser-use open ...`
- `"Enter ${username} in the ID input field"` → `browser-use state` → `browser-use input {index} "..."`
- `"Click the Sign in button"` → `browser-use state` → `browser-use click {index}`
- `"Verify that Dashboard text is visible"` → check text existence via `browser-use state`
- `"Verify URL contains /main"` → check URL via `browser-use state`

### 3. Create Report Directory

```
reports/{YYYY-MM-DD_HH-MM-SS}/
  artifacts/{feature_name_case_name}/    ← only created if --screenshot is enabled
  summary.json
  report.html
```

- Replace spaces with `_` in feature and case names.
- Run `mkdir -p` via the Bash tool.

### 4. Execute Scenarios

Execute cases in parallel using the Agent tool. The `--parallel N` argument controls how many cases run concurrently (default: 2).

- If `--parallel 1`: execute cases sequentially (one at a time)
- If `--parallel N` (N >= 2): use a **worker pool** pattern with N slots

Each Agent runs its case in an independent browser session using `--session case_{index}` to avoid conflicts.

> When there is only 1 case in the YAML, parallel has no effect — just run it directly.

#### Parallel Execution: Worker Pool Pattern

Use `run_in_background: true` for Agent calls to implement a true worker pool:

1. Launch up to N background Agents for the first N cases
2. **As soon as any single Agent completes**, immediately launch the next pending case in that freed slot — do NOT wait for all N agents to finish
3. Repeat until all cases are done
4. Collect all results

This ensures maximum throughput: if case 1 finishes in 2 minutes but case 2 takes 5 minutes, case 3 starts at the 2-minute mark, not the 5-minute mark.

#### Parallel Execution: Session Isolation

Each case MUST use a unique browser session to prevent conflicts:
- Case 1 → `--session case_1`
- Case 2 → `--session case_2`
- etc.

**CRITICAL:** When running in parallel, each Agent handles its own browser session independently. Input fields, cookies, and page state are fully isolated between sessions. Never reuse or share a session across concurrent cases.

#### Parallel Execution: Unique Test Data

**CRITICAL:** When cases run in parallel, their test data values that create resources (e.g., project names, usernames, group names) MUST be unique across cases to avoid conflicts. Before executing, append `_{case_index}` or a timestamp suffix to any resource-creating values in `test_data`.

Example: if `test_data` has `project_name: "test-project"`:
- Case 1 → `test-project_1`
- Case 2 → `test-project_2`
- Case 3 → `test-project_3`

This only applies to values that **create new resources** on the system. Values used for lookup, login, or read-only operations (e.g., `login_username`, `search_query`) should NOT be modified.

#### 4-1. Open Browser

For each case, identify the URL from the first step's action and open the browser with a unique session name.

```bash
browser-use --session case_{index} --headed open "{URL}"
```

If `--headless` is specified, omit `--headed`.

#### 4-2. Handle SSL Certificate Warnings

If `browser-use state` output contains "Your connection is not private" or "ERR_CERT":
1. Click the "Advanced" or "Details" button
2. Click the "Proceed to (unsafe)" link
3. Verify the page loaded correctly via `browser-use state`

#### 4-3. Execute Each Step

For each step, perform the following:

1. **Save Before screenshot** (only if `--screenshot` is enabled)
   ```bash
   browser-use --session case_{index} screenshot reports/{timestamp}/artifacts/{feature_case}/step_{NN}_before.png
   ```

2. **Interpret and execute the action**

   Read the `action` string, understand its natural language meaning, and execute the appropriate browser-use commands:

   - **Navigation** (action contains a URL, "navigate", "go to", "open"):
     → `browser-use open "{URL}"`

   - **Input** (action contains "enter", "input", "type"):
     → `browser-use state` to find element → `browser-use input {index} "{value}"`

   - **Click** (action contains "click", "press", "tap"):
     → `browser-use state` to find element → `browser-use click {index}`

   - **Verification** (action contains "verify", "check", "confirm", "assert", "visible"):
     → Check text/URL/element existence via `browser-use state`
     → If not found, retry with `browser-use eval "document.body.innerText"`
     → Record result as assertion (pass/fail)

   - **Other**: Interpret the action context as best as possible and execute with appropriate browser-use command combinations

   **Core Principle:** Always check the current page state via `browser-use state` first, then select the element that best matches the action description.

3. **Save After screenshot** (only if `--screenshot` is enabled)
   ```bash
   browser-use --session case_{index} screenshot reports/{timestamp}/artifacts/{feature_case}/step_{NN}_after.png
   ```

4. **If the action includes verification**, record the result in the assertions array.

5. **Record step result:**
   - `index`: step number (starting from 1)
   - `action`: the step's action text
   - `status`: "pass" | "fail" | "error"
   - `method`: "claude-browser-use"
   - `locator`: the actual browser-use command used
   - `assertions`: array of verification results
   - `error`: error message (null if none)
   - `screenshots`: before/after paths (only if `--screenshot` is enabled, otherwise omit)

#### 4-4. Determine Result Based on expected_result

When determining the final result for each case, check the `expected_result` field:

- **`expected_result: "pass"`** (default):
  - All steps pass → case **PASS**
  - Any step fails → case **FAIL**

- **`expected_result: "fail"`** (error/negative case):
  - Last verification step passes (error message displayed correctly) → case **PASS**
  - No error message shown, normal screen appears → case **FAIL** (error was expected but didn't occur)
  - Unexpected error → case **ERROR**

> In other words, `expected_result: "fail"` cases verify that "the error message is displayed correctly."

#### 4-5. Cleanup

After each case execution:
```bash
browser-use --session case_{index} cookies clear
browser-use --session case_{index} close
```

### 5. Generate summary.json

Save in the following format using the Write tool:

```json
{
  "executed_at": "{timestamp}",
  "mode": "claude-browser-use",
  "feature": "Feature Name",
  "total": 5,
  "passed": 4,
  "failed": 1,
  "errors": 0,
  "cases": [
    {
      "name": "Case Name",
      "expected_result": "pass",
      "status": "pass",
      "duration_ms": 12345,
      "steps": [
        {
          "index": 1,
          "action": "Action description",
          "status": "pass",
          "method": "claude-browser-use",
          "locator": "browser-use input 5 'testuser'",
          "assertions": [
            {
              "type": "text_visible",
              "expected": "Dashboard",
              "actual": "Dashboard (visible in navigation)",
              "passed": true
            }
          ],
          "error": null
        }
      ]
    }
  ]
}
```

### 6. Generate HTML Report

Read the HTML template from `references/report-template.html` (relative to this SKILL.md), then fill in the placeholder values and save as `report.html` via the Write tool.

**Placeholder values to substitute:**
- `{executed_at}` → timestamp string
- `{total}`, `{passed}`, `{failed}`, `{errors}` → summary counts
- `{pass_rate}` → percentage (0–100)
- `{feature_name}` → feature name from YAML
- Per case: `{case_name}`, `{status}`, `{STATUS}` (uppercase), `{step_count}`, `{duration_ms}`
- Per step: `{index}`, `{action}`, `{locator}`, `{duration_ms}`, `{error_message}`
- Per assertion: `{type}`, `{expected}`, `{actual}`
- Show `badge-expected-fail` span only when `expected_result` is `"fail"`

### 7. Output Results

After execution, output in this format:

```
====================================
{Feature Name} — Total {total} | Passed {passed} | Failed {failed} | Errors {errors}
Report: reports/{timestamp}/report.html
====================================
```

## References

- `references/report-template.html` — HTML report template. Read this file in Step 6 to generate `report.html`.

## Notes

- Input values for steps with `sensitive: true` are masked as `****` in the output.
- SSL certificate warnings are automatically bypassed.
- At each step, inspect the element list via `browser-use state` and select the element that best matches the action description. This is the core of this skill — AI observes the screen and makes decisions.
- If a directory is given as the argument, all `.yaml` files in that directory are executed sequentially.
- If `depends_on` exists between scenarios, dependent scenarios are executed first.
- In the **cases structure**, each case runs in an independent browser session (state isolation between cases).
- **expected_result: "fail"** cases verify that error messages are displayed correctly. If the error is shown → PASS; if no error and normal operation occurs → FAIL.
- Legacy single-scenario structure (Format B) YAML files are fully compatible.
- To avoid Python 3.14 compatibility issues, **uv venv + Python 3.12** is recommended. Use the `BROWSER_USE_CMD` path detected in step 0 consistently for all commands.
