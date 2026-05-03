---
name: aqa-smart
description: Automatically generate YAML QA test scenarios by analyzing a Figma design file, then execute them against a live target URL. Use when the user provides a Figma link and a target service URL — even if they say "피그마로 테스트 만들어줘", "Figma URL로 시나리오 생성해줘", "auto-generate tests from design", or "스마트 테스트 실행해줘".
---

# AQA Smart - Figma-Driven QA Scenario Generator & Runner

Fetches a Figma design file via API, analyzes its UI components and flows, generates a YAML test scenario draft, pauses for human review, then runs the confirmed scenario via aqa-run.

## Language

**CRITICAL:** Detect the user's language and use it for ALL interactions — questions, status messages, review prompts, and output. English in this document is reference only.

## Trigger

Use when the user provides a Figma URL and a target service URL and wants to auto-generate and run QA tests.

## Arguments

- `<figma_url>` — Figma file or frame URL (required)
- `<target_url>` — Live service URL to run tests against (required)
- `--headed` — Run browser with visible window (default)
- `--headless` — Run in headless mode
- `--screenshot` — Capture before/after screenshots per step (default: off)
- `--parallel N` — Run N cases concurrently (default: 2)
- `--save <path>` — Directory to save generated YAML (default: `scenarios/`)

## Workflow

Follow the steps below **exactly**.

---

### Step 0: Resolve Figma Access Token

Search for `FIGMA_ACCESS_TOKEN` in this priority order:

1. Check `.env` in the current working directory for `FIGMA_ACCESS_TOKEN=...`
2. Check `.env.local` for `FIGMA_ACCESS_TOKEN=...`
3. Check shell environment: `echo $FIGMA_ACCESS_TOKEN`

If **not found** in any of the above, ask the user directly:

> "I need a Figma Personal Access Token to fetch the design file.
> You can generate one at: Figma → Profile → Settings → Security → Personal access tokens
> Please paste your token here:"

Store the token as `FIGMA_TOKEN` for use in subsequent API calls.

---

### Step 1: Parse Figma URL

Extract the file key and optional node ID from the provided Figma URL.

#### URL Patterns

```
# File URL
https://www.figma.com/file/{FILE_KEY}/{title}

# Design URL (with node)
https://www.figma.com/design/{FILE_KEY}/{title}?node-id={NODE_ID}

# Prototype URL
https://www.figma.com/proto/{FILE_KEY}/{title}?node-id={NODE_ID}
```

- Extract `FILE_KEY` (always present)
- Extract `NODE_ID` from `?node-id=` query param if present (optional — used to scope analysis to a specific frame)
- URL-decode the node ID if needed (e.g., `123-456` or `123%3A456` both valid)

---

### Step 2: Fetch Figma File Structure

Call the Figma REST API using bash:

```bash
# Fetch full file structure
curl -s -H "X-Figma-Token: {FIGMA_TOKEN}" \
  "https://api.figma.com/v1/files/{FILE_KEY}" \
  -o /tmp/figma_file.json

# If NODE_ID is present, also fetch node-specific data
curl -s -H "X-Figma-Token: {FIGMA_TOKEN}" \
  "https://api.figma.com/v1/files/{FILE_KEY}/nodes?ids={NODE_ID}" \
  -o /tmp/figma_nodes.json
```

If the API call fails (non-200 response or error field in JSON):
- Check if the error is `"Invalid token"` → ask the user for a new token
- Check if the error is `"Not found"` → tell the user the file is not accessible (may be private or URL is wrong)
- Other errors → show the raw error message and stop

---

### Step 3: Analyze Figma Design

Read `/tmp/figma_file.json` (and `/tmp/figma_nodes.json` if available) and extract the following:

#### 3-1. Identify Target Frame(s)

- If `NODE_ID` was provided: focus analysis on that specific frame/component
- If no `NODE_ID`: analyze the top-level frames (pages → frames) and pick the most relevant ones based on the feature name or page title

#### 3-2. Extract UI Components

For each target frame, identify:

| Component Type | Detection Criteria |
|---|---|
| **Input fields** | node type `TEXT` inside frame with `fills` suggesting input styling, or component name containing "input", "field", "text" |
| **Buttons** | node type `FRAME` or `COMPONENT` with name containing "button", "btn", "cta", "submit" |
| **Labels / Headings** | `TEXT` nodes with large font size or bold weight |
| **Error states** | frames or components named with "error", "warning", "invalid", "fail" |
| **Success states** | frames or components named with "success", "confirm", "complete" |
| **Navigation elements** | links, tabs, breadcrumbs, back buttons |
| **Form structure** | grouping of inputs + submit button = a form |

#### 3-3. Infer User Flows

From the extracted components, infer the primary user flows:

1. **Happy path**: the sequence of interactions that leads to a successful outcome
   - e.g., fill inputs → click submit → see success state
2. **Error paths**: interactions that should trigger error states
   - e.g., submit empty form → see error message
   - e.g., enter invalid format → see validation error

#### 3-4. Extract Test Data Hints

From label text and placeholder text in the Figma design:
- Input field labels → map to test data keys (e.g., "Email" → `email`, "Password" → `password`)
- Placeholder text → use as example test data values
- If no hints available, use generic defaults (`testuser@example.com`, `TestPassword123!`)

---

### Step 4: Generate YAML Draft

Using the analysis from Step 3, generate a YAML scenario draft in the standard aqa-run format.

#### Rules

- `BASE_URL` is always extracted from `<target_url>` argument and placed in every case's `test_data`
- Steps are written as natural language actions referencing `${variable}` from `test_data`
- Generate **1 success case** + **N error cases** (one per identified error state in the design)
- If login screens are detected in the Figma (login page frame exists), ask the user:
  > "The design appears to include a login screen. Does the target feature require login first? (Y/n)"
  > If Y: ask for login credentials and prepend login steps to all cases

#### YAML Template

```yaml
name: "{Feature name inferred from Figma frame title}"
description: "{Brief description of what this screen does}"
tags: [{auto-generated tags}]

cases:
  - name: "Success: {happy path description}"
    priority: critical
    expected_result: "pass"
    test_data:
      BASE_URL: "{target_url base}"
      {input_field_key}: "{example value}"
    steps:
      - action: "Navigate to ${BASE_URL}{path}"
      - action: "Enter ${field_key} in the {label} field"
      - action: "Click the {button label} button"
      - action: "Verify that {success state text or element} is visible"
    cleanup:
      - type: clear_cookies

  - name: "Error: {error state description}"
    priority: high
    expected_result: "fail"
    test_data:
      BASE_URL: "{target_url base}"
      {input_field_key}: "{invalid or empty value}"
    steps:
      - action: "Navigate to ${BASE_URL}{path}"
      - action: "{steps that trigger the error}"
      - action: "Verify that {error message or error state} is visible"
    cleanup:
      - type: clear_cookies
```

---

### Step 5: Human-in-the-Loop Review

**CRITICAL — Do not skip this step.**

Show the generated YAML draft to the user and pause for review.

Output the following:

```
====================================
Draft scenario generated from Figma analysis.
Feature: {feature name}
Cases: {N} (Success: {X}, Error: {Y})
====================================

{full YAML content in a code block}

====================================
Please review the scenario above.
- Type "ok" or "yes" to confirm and run
- Type "edit" to modify before running
- Type "save" to save without running
- Type "cancel" to abort
====================================
```

Wait for user input:

- **"ok" / "yes"**: proceed to Step 6
- **"edit"**: ask the user what to change, apply the edits, show the updated YAML, and return to this review prompt
- **"save"**: save the YAML to `--save` path (or `scenarios/`) and stop — do not run
- **"cancel"**: abort and stop

---

### Step 6: Save YAML

Determine save path:
- If `--save <path>` was provided, use that directory
- Otherwise default to `scenarios/`
- File name: `{feature_name_snake_case}.yaml` (e.g., `login.yaml`, `signup_form.yaml`)
- Create directory if it does not exist

Save the confirmed YAML content using the Write tool.

Output:
```
Saved: {full save path}
```

---

### Step 7: Run via aqa-run

Read the skill at `skills/aqa-run/SKILL.md` and execute the saved YAML file following the full aqa-run workflow, passing through all flags (`--headed`/`--headless`, `--screenshot`, `--parallel N`).

The `BASE_URL` in the YAML's `test_data` is already set to `<target_url>` — no further substitution needed.

---

## Notes

- Figma API rate limit: 30 requests/minute per token. If rate-limited, wait 60 seconds and retry.
- If the Figma file has many frames, limit analysis to the frame(s) most relevant to the target URL path.
- If component names in Figma are generic (e.g., "Frame 12", "Rectangle 5"), rely on visual structure (position, size, fill) to infer component type.
- The generated YAML is a **draft** — the Human-in-the-Loop step in Step 5 is mandatory to catch hallucinations before execution.
- After review and confirmation, this skill delegates execution entirely to the aqa-run skill — do not re-implement execution logic here.
