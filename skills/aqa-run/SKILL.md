---
name: aqa-run
description: Run YAML-based QA test scenarios via browser-use CLI and generate HTML reports with screenshots. AI-driven browser automation that reads scenarios, executes steps, and produces summary.json + report.html.
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
  artifacts/{feature_name_case_name}/    ← screenshots per case
  summary.json
  report.html
```

- Replace spaces with `_` in feature and case names.
- Run `mkdir -p` via the Bash tool.

### 4. Execute Scenarios

Execute all cases in the YAML sequentially. Each case runs in an independent browser session.

#### 4-1. Open Browser

Identify the URL from the first step's action of each case and open the browser.

```bash
browser-use --headed open "{URL}"
```

If `--headless` is specified, omit `--headed`.

#### 4-2. Handle SSL Certificate Warnings

If `browser-use state` output contains "Your connection is not private" or "ERR_CERT":
1. Click the "Advanced" or "Details" button
2. Click the "Proceed to (unsafe)" link
3. Verify the page loaded correctly via `browser-use state`

#### 4-3. Execute Each Step

For each step, perform the following:

1. **Record start time** (via Bash: `date +%s%3N`)

2. **Save Before screenshot**
   ```bash
   browser-use screenshot reports/{timestamp}/artifacts/{feature_case}/step_{NN}_before.png
   ```

3. **Interpret and execute the action**

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

4. **Save After screenshot**
   ```bash
   browser-use screenshot reports/{timestamp}/artifacts/{feature_case}/step_{NN}_after.png
   ```

5. **If the action includes verification**, record the result in the assertions array.

6. **Record end time** → calculate duration_ms

7. **Record step result:**
   - `index`: step number (starting from 1)
   - `action`: the step's action text
   - `status`: "pass" | "fail" | "error"
   - `method`: "claude-browser-use"
   - `locator`: the actual browser-use command used
   - `assertions`: array of verification results
   - `error`: error message (null if none)
   - `duration_ms`: elapsed time
   - `screenshots.before`: relative path to before screenshot
   - `screenshots.after`: relative path to after screenshot

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
browser-use cookies clear
browser-use close
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
          "error": null,
          "duration_ms": 1234,
          "screenshots": {
            "before": "reports/.../step_01_before.png",
            "after": "reports/.../step_01_after.png"
          }
        }
      ]
    }
  ]
}
```

### 6. Generate HTML Report

Generate `report.html` using the HTML template below via the Write tool.
Embed screenshots as inline base64 (obtain via Bash: `base64 -i {path}`).

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>AI QA Report (Claude Code) - {executed_at}</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f3f4f6; }
    code { background: #e5e7eb; padding: 1px 4px; border-radius: 3px; font-size: 11px; word-break: break-all; }
    .summary-cards { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .card { padding: 16px 24px; border-radius: 12px; border: 1px solid #e5e7eb; text-align: center; min-width: 100px; }
    .card-value { font-size: 32px; font-weight: bold; }
    .card-label { color: #666; font-size: 13px; }
    .card-total { background: #fff; }
    .card-pass { background: #f0fdf4; border-color: #bbf7d0; }
    .card-pass .card-value { color: #22c55e; }
    .card-fail { background: #fef2f2; border-color: #fecaca; }
    .card-fail .card-value { color: #ef4444; }
    .card-error { background: #fff7ed; border-color: #fed7aa; }
    .card-error .card-value { color: #f97316; }
    .card-rate { background: #fff; }
    .feature-title { font-size: 14px; color: #666; margin-bottom: 16px; }
    .case { border: 1px solid #d1d5db; border-radius: 12px; padding: 16px; margin: 16px 0; background: #fafafa; }
    .case-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .badge { color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .badge-pass { background: #22c55e; }
    .badge-fail { background: #ef4444; }
    .badge-error { background: #f97316; }
    .badge-expected-fail { background: #6366f1; }
    .step { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin: 8px 0; background: #fff; }
    .step-header { display: flex; justify-content: space-between; align-items: center; }
    .step-action { margin-top: 4px; color: #1d4ed8; font-size: 13px; }
    .step-meta { font-size: 12px; color: #666; }
    .step-error { color: #ef4444; font-size: 13px; margin-top: 4px; }
    .assertion-pass { color: #166534; font-size: 12px; }
    .assertion-fail { color: #991b1b; font-size: 12px; }
    .screenshot { max-width: 500px; border: 1px solid #ddd; border-radius: 4px; margin-top: 8px; }
    .screenshots { display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
    .screenshot-label { font-size: 11px; color: #999; margin-bottom: 2px; }
    .expected-label { font-size: 11px; color: #6366f1; font-weight: bold; }
</style>
</head>
<body>
    <h1>AI QA Report <span style="font-size:16px;color:#666">(Claude Code + browser-use)</span></h1>
    <div style="color:#666;margin-bottom:20px">{executed_at}</div>

    <!-- Summary Cards -->
    <div class="summary-cards">
        <div class="card card-total"><div class="card-value">{total}</div><div class="card-label">Total Cases</div></div>
        <div class="card card-pass"><div class="card-value">{passed}</div><div class="card-label">Passed</div></div>
        <div class="card card-fail"><div class="card-value">{failed}</div><div class="card-label">Failed</div></div>
        <div class="card card-error"><div class="card-value">{errors}</div><div class="card-label">Errors</div></div>
        <div class="card card-rate"><div class="card-value">{pass_rate}%</div><div class="card-label">Pass Rate</div></div>
    </div>

    <div class="feature-title">Feature: {feature_name}</div>

    <!-- Cases: repeat block below for each case -->
    <div class="case">
        <div class="case-header">
            <h3>
                {case_name}
                <span class="badge badge-{status}">{STATUS}</span>
                <!-- Show only when expected_result is "fail" -->
                <span class="badge badge-expected-fail">Expected Fail</span>
            </h3>
            <span class="step-meta">{step_count} steps | {duration_ms}ms</span>
        </div>

        <!-- Steps: repeat block below for each step -->
        <div class="step">
            <div class="step-header">
                <b>Step {index}</b>
                <span class="step-meta">{duration_ms}ms</span>
            </div>
            <div class="step-action">{action}</div>
            <div class="step-meta"><code>{locator}</code></div>

            <!-- Assertion results -->
            <div class="assertion-pass">PASS: {type} — expected: {expected}, actual: {actual}</div>
            <!-- or -->
            <div class="assertion-fail">FAIL: {type} — expected: {expected}, actual: {actual}</div>

            <!-- If error exists -->
            <div class="step-error">Error: {error_message}</div>

            <!-- Screenshots (base64 inline) -->
            <div class="screenshots">
                <div>
                    <div class="screenshot-label">Before</div>
                    <img class="screenshot" src="data:image/png;base64,{base64_data}">
                </div>
                <div>
                    <div class="screenshot-label">After</div>
                    <img class="screenshot" src="data:image/png;base64,{base64_data}">
                </div>
            </div>
        </div>
        <!-- /Steps -->
    </div>
    <!-- /Cases -->

    <div style="text-align:center;color:#999;font-size:12px;margin-top:40px;padding:20px">
        Generated by AI QA Automation (Claude Code + browser-use)
    </div>
</body>
</html>
```

### 7. Output Results

After execution, output in this format:

```
====================================
{Feature Name} — Total {total} | Passed {passed} | Failed {failed} | Errors {errors}
Report: reports/{timestamp}/report.html
====================================
```

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
