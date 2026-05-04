---
name: aqa-spec
description: Generate YAML QA test scenario files. Default mode is an interactive Q&A; passing --figma <url> (or -f <url>) switches to a Figma-driven mode that analyzes a design file and auto-drafts the scenario with a mandatory human review. Use this skill whenever the user wants to create, generate, or scaffold a QA test scenario — even if they just say "시나리오 만들어줘", "make a test case", "generate a scenario", "피그마로 시나리오 만들어줘", or "Figma URL로 시나리오 생성해줘".
---

# AQA Spec - QA Scenario Generator (Q&A + Figma)

Generates YAML scenario files compatible with `/aqa-run`. Two input modes selected by flags. This skill **never runs scenarios** — execution is the responsibility of the `aqa-run` skill.

## Language

**CRITICAL:** Detect the user's language from their messages and use it for ALL interactions — questions, status messages, review prompts, and generated YAML content (action fields). The English in this document is reference only. Translate before showing to the user if their language is not English.

## Trigger

Use when the user wants to create or generate a QA test scenario YAML file, regardless of whether they're using interactive Q&A or providing a Figma design.

## Arguments

| Flag | Q&A mode | Figma mode | Description |
|---|---|---|---|
| `--figma <url>` / `-f <url>` | — | **required** | Figma file or frame URL — switches to Figma mode |
| `--target <url>` | optional (asked if missing) | **required** | Live service URL — saved as `BASE_URL` in the YAML |
| `--save <path>` | optional (asked if missing) | optional (default `scenarios/`) | Save directory or full file path |

## Mode Dispatch

Inspect the arguments **before doing anything else**:

- If `--figma <url>` or `-f <url>` is present → **Figma mode** (jump to "Figma Mode Workflow").
  - If `--target <url>` is missing in Figma mode, ask the user for it before proceeding.
- Otherwise → **Q&A mode** (jump to "Q&A Mode Workflow").

Both modes end at the same "Common Output" section.

---

## Q&A Mode Workflow

Follow these steps **exactly**.

### 1. Collect User Input

Use the AskUserQuestion tool to ask the items below **one at a time**, in order. Include examples in each question so the user can answer easily.

#### Required items

1. **Feature Name**
   > "What feature do you want to create a scenario for? (e.g., Login, Signup, Project Creation)"

2. **Description**
   > "Describe this feature in one line. (e.g., User authentication to access the system)"

3. **Login Required (Pre-authentication)**
   > "Does this feature require login to test? (Y/n)"
   > "If Y, login steps will be automatically prepended to every case."

   - If **Y** (or empty): ask the following sub-questions:
     > "What is the login page URL path? (e.g., /welcome, /login)"

     > "Provide the login credentials in key=value format."
     > "(e.g., login_username=admin, login_password=Secret123!)"

   - If **n**: skip — no login steps will be added.
   - Store the login page path and credentials separately. These are **not** part of the feature's test_data — they only prepend login steps.
   - Login steps are a **precondition**, not a test target. No assertions or error cases are generated for them.

4. **Target Page URL Path**
   - If `--target <url>` was passed, skip this question — extract the domain and store as `BASE_URL`, then ask only for the path:
     > "What is the URL path of the page to test? (e.g., /projects/new, /users, /settings)"
   - Otherwise:
     > "What is the URL path of the page to test? (e.g., /projects/new, /users, /settings)"
     > "You can also enter a full URL. (e.g., https://example.com/projects/new)"

   - If a full URL is entered, extract the domain (e.g., `https://example.com`) and store it as `BASE_URL`. The remaining path is used as the target path.
   - If only a path is entered (and no `--target`), ask the user for the base URL separately:
     > "What is the base URL of the application? (e.g., https://example.com)"
   - `BASE_URL` is saved into every case's `test_data`.

5. **Test Data (Success Case)**
   > "Provide the test data for the success case in key=value format, separated by commas."
   > "(e.g., project_name=MyProject, description=Test project)"
   > "Enter 'none' if not needed."

6. **Success Case Steps**
   > "Describe the steps for the success case, one per line."
   > "Write freely in natural language."
   > ""
   > "Examples:"
   > "Navigate to ${BASE_URL}/welcome and verify URL contains /welcome"
   > "Enter ${username} in the ID input field"
   > "Enter ${password} in the password field"
   > "Click the login button and wait for page load"
   > "Verify that Dashboard text is visible (15 second timeout)"
   > ""
   > "Type 'done' when finished."

7. **Auto-generate Error Cases**
   > "Would you like to automatically add error cases (failure scenarios) for this feature? (Y/n)"
   > "If Y, AI will auto-generate common error cases."
   > "Type 'manual' if you want to specify error cases yourself."

   - **Y** (or empty): proceed to "Auto-generate Error Cases" below
   - **n**: generate only the success case
   - **manual**: collect error cases with this format:
     > "Please provide error cases one at a time in this format:"
     > "Case name | data_to_change(key=value) | expected_result"
     > ""
     > "Examples:"
     > "Wrong password | password=wrongpass!! | Invalid username or password"
     > "Non-existent account | username=nobody123 | Invalid username or password"
     > "Empty fields | username=, password= | Please enter your ID"
     > ""
     > "Type 'done' when finished."

8. **Save Path**
   - If `--save <path>` was passed, skip this question.
   - Otherwise:
     > "Enter the file path to save. (default: current directory)"
     > "(e.g., scenarios/auth/login.yaml)"
     > "If you enter only a filename, it will be saved in the current directory."

### 2. Parse Input

#### Tags (auto-generated)
- Do NOT ask the user for tags.
- Generate 2-3 tags from feature name + description.
- Examples: "Login" → `[auth, login]`, "Project Creation" → `[project, create]`, "User Search" → `[user, search]`.

#### Test data
- Parse `key=value` pairs into a `test_data` map.
- **Always include `BASE_URL`** as the first entry in every case's `test_data`.
- Keys containing `password`, `secret`, `token`, etc. → set `sensitive: true` on the relevant input step.
- If the user entered "none", still include `BASE_URL`.

#### Steps parsing
- `action`: use the natural language sentence as-is (may contain `${...}` variables).
- A single `action` field describes all behavior. `aqa-run` interprets the natural language and runs the appropriate browser-use commands.

#### File path
- If no extension, append `.yaml`.
- Relative paths resolve relative to the current working directory.
- Create the directory if it does not exist.

### 3. Auto-generate Error Cases

If the user chose auto-generation, create error cases based on the feature type.

Error case steps reuse the **target page URL path** from the success case (`${BASE_URL}{path}`). Start from the success case's step flow, then introduce variations that trigger errors.

#### Error case patterns by feature type

**Login-related** (feature/action contains "login", "sign in", "authentication"):
- Wrong password: change password to `wrongpassword!!`
- Non-existent account: change username to `nonexistent_user_999`
- Empty username: set username to empty, enter only password
- Empty password: enter only username, set password to empty
- All fields empty: submit without entering anything

**Signup-related** (contains "signup", "register", "sign up", "create account"):
- Duplicate email/username: use an existing value
- Password mismatch: enter a different value in confirm-password
- Invalid email format: `invalid-email`
- Short password: `123`
- Missing required fields: leave each required field empty one at a time

**Search-related** (contains "search"):
- No results: `zzz_no_result_query_999`
- Empty search query
- Special characters: `<script>alert(1)</script>`

**Form-submission** (contains "create", "submit", "register", "add"):
- Missing required fields one at a time
- Max length exceeded: very long string
- Special character input: SQL-injection patterns like `' OR 1=1 --`

**Other**: analyze the core inputs and generate cases with empty / invalid / boundary values.

#### Per-case construction rules

1. **name**: clearly describe the error situation
2. **priority**: one level lower than the success case (critical → high, high → medium)
3. **test_data**: copy success case test_data, then change values to trigger the error
4. **steps**: based on success case, but:
   - Modify input-step actions where values differ
   - Replace the last verification step with error-message verification
   - For empty-input cases, remove the corresponding input step
5. **expected_result**: `"fail"` (the error occurring is the expected normal behavior)

> If the expected error message is unknown, use a `visual` assertion so AI can determine error state from the screen.

### 4. Generate YAML

Fill the template below and **save the file directly** using the Write tool. **Do not show a review gate** — the user already authored every input via Q&A.

#### Login precondition steps

If the user answered **Y** to "Login Required", prepend these steps to **every** case's `steps`. Also add `login_username` and `login_password` to each case's `test_data`.

```yaml
- action: "Navigate to ${BASE_URL}{login_page_path}"
- action: "Enter ${login_username} in the ID input field"
- action: "Enter ${login_password} in the password field"
  sensitive: true
- action: "Click the login button and wait for page load"
```

These login steps are a **precondition only** — no assertions, no error cases generated for them.

#### Cases structure (with error cases)

```yaml
name: "{Feature Name}"
description: "{Description}"
tags: [{tags}]

cases:
  - name: "{Success Case Name}"
    priority: critical
    expected_result: "pass"
    test_data:
      BASE_URL: "{base_url}"
      login_username: "{login_user}"     # only if login required
      login_password: "{login_pass}"     # only if login required
      {key}: "{value}"
    steps:
      # Login precondition (auto-inserted if login required)
      - action: "Navigate to ${BASE_URL}{login_path}"
      - action: "Enter ${login_username} in the ID input field"
      - action: "Enter ${login_password} in the password field"
        sensitive: true
      - action: "Click the login button and wait for page load"
      # Actual test steps
      - action: "{Natural language action description}"
    cleanup:
      - type: clear_cookies

  - name: "{Error Case 1 Name}"
    priority: high
    expected_result: "fail"
    test_data:
      BASE_URL: "{base_url}"
      {key}: "{modified value}"
    steps:
      - action: "{Natural language action description}"
    cleanup:
      - type: clear_cookies
```

#### Single case (success only)

```yaml
name: "{Feature Name}"
description: "{Description}"
tags: [{tags}]

cases:
  - name: "{Success Case Name}"
    priority: critical
    expected_result: "pass"
    test_data:
      BASE_URL: "{base_url}"
      {key}: "{value}"
    steps:
      - action: "{Natural language action description}"
    cleanup:
      - type: clear_cookies
```

After saving, jump to "Common Output".

---

## Figma Mode Workflow

Follow these steps **exactly**.

### F-0. Resolve Figma Access Token

Search for `FIGMA_ACCESS_TOKEN` in this priority order:

1. `.env` in the current working directory
2. `.env.local`
3. Shell environment: `echo $FIGMA_ACCESS_TOKEN`

If not found, ask the user directly:

> "I need a Figma Personal Access Token to fetch the design file.
> You can generate one at: Figma → Profile → Settings → Security → Personal access tokens
> Please paste your token here:"

Store as `FIGMA_TOKEN` for subsequent calls.

### F-1. Parse Figma URL

Extract the file key and optional node ID from the provided Figma URL.

```
# File URL
https://www.figma.com/file/{FILE_KEY}/{title}

# Design URL (with node)
https://www.figma.com/design/{FILE_KEY}/{title}?node-id={NODE_ID}

# Prototype URL
https://www.figma.com/proto/{FILE_KEY}/{title}?node-id={NODE_ID}
```

- Extract `FILE_KEY` (always present)
- Extract `NODE_ID` from `?node-id=` query param if present (used to scope analysis to a specific frame)
- URL-decode the node ID if needed (e.g., `123-456` or `123%3A456` both valid)

### F-2. Fetch Figma File Structure

```bash
# Full file structure
curl -s -H "X-Figma-Token: {FIGMA_TOKEN}" \
  "https://api.figma.com/v1/files/{FILE_KEY}" \
  -o /tmp/figma_file.json

# Optional node-specific data
curl -s -H "X-Figma-Token: {FIGMA_TOKEN}" \
  "https://api.figma.com/v1/files/{FILE_KEY}/nodes?ids={NODE_ID}" \
  -o /tmp/figma_nodes.json
```

If the API call fails:
- `"Invalid token"` → ask the user for a new token
- `"Not found"` → tell the user the file is not accessible (private or wrong URL)
- Other errors → show raw error message and stop

### F-3. Analyze Figma Design

Read `/tmp/figma_file.json` (and `/tmp/figma_nodes.json` if available) and extract:

#### F-3.1 Identify target frame(s)
- If `NODE_ID` provided: focus on that specific frame/component
- Otherwise: analyze top-level frames and pick the most relevant ones

#### F-3.2 Extract UI components

| Component type | Detection criteria |
|---|---|
| **Input fields** | `TEXT` inside frame with input-style fills, or component name containing "input", "field", "text" |
| **Buttons** | `FRAME` or `COMPONENT` with name containing "button", "btn", "cta", "submit" |
| **Labels / Headings** | `TEXT` nodes with large font size or bold weight |
| **Error states** | frames or components named with "error", "warning", "invalid", "fail" |
| **Success states** | frames or components named with "success", "confirm", "complete" |
| **Navigation elements** | links, tabs, breadcrumbs, back buttons |
| **Form structure** | grouping of inputs + submit button = a form |

#### F-3.3 Infer user flows

1. **Happy path**: fill inputs → click submit → see success state
2. **Error paths**: trigger error states (e.g., empty form → error message; invalid format → validation error)

#### F-3.4 Extract test data hints

From label and placeholder text:
- Input field labels → test data keys (e.g., "Email" → `email`, "Password" → `password`)
- Placeholder text → example test data values
- Fall back to defaults: `testuser@example.com`, `TestPassword123!`

### F-4. Detect Login & Confirm

If the design appears to include a login screen (login frame exists), ask:

> "The design appears to include a login screen. Does the target feature require login first? (Y/n)"

If **Y**: ask for login credentials and prepend the standard login steps to every case (same precondition pattern as Q&A mode's section "Login precondition steps").

### F-5. Generate YAML Draft

Use the Q&A-mode YAML templates ("Cases structure" / "Single case") as the canonical format. Fill them with:

- `BASE_URL` from the `--target <url>` argument (always present in Figma mode)
- 1 success case + N error cases (one per identified error state)
- Test data keys derived from F-3.4

### F-6. Human-in-the-Loop Review

**CRITICAL — do not skip this step.**

Show the generated YAML draft to the user and pause for review:

```
====================================
Draft scenario generated from Figma analysis.
Feature: {feature name}
Cases: {N} (Success: {X}, Error: {Y})
====================================

{full YAML content in a code block}

====================================
Please review the scenario above.
- Type "ok" or "yes" to confirm and save
- Type "edit" to modify before saving
- Type "save" to save without further changes (same as "ok" in this skill — kept for clarity)
- Type "cancel" to abort
====================================
```

Wait for input:

- **"ok" / "yes" / "save"**: proceed to F-7
- **"edit"**: ask what to change, apply edits, show updated YAML, return to this prompt
- **"cancel"**: abort and stop

### F-7. Save YAML

- Save path: `--save <path>` if provided, else `scenarios/`
- File name: `{feature_name_snake_case}.yaml` (e.g., `login.yaml`, `signup_form.yaml`)
- Create directory if missing
- Save with the Write tool

After saving, jump to "Common Output".

---

## Common Output

After saving (Q&A mode at step 4, Figma mode at F-7), print:

```
====================================
Scenario saved!
File: {save path}
Feature: {feature name}
Cases: {total} (Success: {N}, Error: {M})
====================================
```

Then show the generated YAML in a code block, followed by the run guide:

```
To run: /aqa-run {save path}
```

This skill never executes the scenario itself — execution is delegated to `/aqa-run`.

## Notes

- If the user's answer is ambiguous, ask follow-up questions for clarification.
- `${BASE_URL}` is always prepended to URLs in actions. Even if the user enters a full URL, convert it to `${BASE_URL}` + path format.
- `BASE_URL` must always be present in `test_data` for every case — `aqa-run` relies on it across sessions.
- `cleanup` includes `clear_cookies` by default for each case.
- If the file already exists, ask the user whether to overwrite it.
- If an error case's expected error message is unknown, use a `visual` assertion:
  ```yaml
  assertions:
    - type: visual
      value: "Is an error message or warning displayed?"
  ```
- Cases with `expected_result: "fail"` are judged **pass** when the error message is correctly displayed (the error is the expected normal behavior).
- Figma API rate limit: 30 requests/minute per token. If rate-limited, wait 60 seconds and retry.
- If Figma component names are generic (e.g., "Frame 12", "Rectangle 5"), rely on visual structure (position, size, fill) to infer component type.
- The Figma-mode YAML is a **draft** — the F-6 review gate is mandatory to catch hallucinations before saving.
