# `cases.yaml` Schema (Authoritative)

This file is the **single source of truth** for the `cases.yaml` schema consumed
and produced by `aqa-inspect`. It replaces the "Format A: Cases Structure"
schema formerly defined in the retired `aqa-run` skill. Both generation paths
(`generate-figma.md`, `generate-explore.md`) emit this schema, and both
execution engines (`engine-browser-use.md`, `engine-playwright.md`) consume it.

## Top-Level Structure

```yaml
name: "Feature Name"
description: "Description"
tags: [tag1, tag2]

cases:
  - case_id: feature-001
    name: "Case Name"
    priority: critical|high|medium|low
    expected_result: "pass|fail"
    test_data:
      BASE_URL: "https://app.example.com"
      key: "value"
    steps:
      - action: "Natural language action description"
    cleanup:
      - type: clear_cookies
```

## Field Reference

### File level

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Feature name covered by this plan. |
| `description` | yes | One-line description of the feature. |
| `tags` | yes | 2–3 short tags derived from the feature (e.g. `[auth, login]`). |
| `cases` | yes | List of test cases (see below). |

### Per case

| Field | Required | Meaning |
|---|---|---|
| `case_id` | **yes** | Stable lowercase slug — feature prefix + zero-padded sequence, e.g. `login-001`. This is the join key for rerun-match (`--rerun-failed` / `--resume`) and Jira dedup. Never renumber or reuse a retired id; new cases get new trailing numbers. Matches the `case_id` column in `results-csv.md`. |
| `name` | yes | Human-readable case title (becomes the Jira summary downstream). |
| `priority` | optional | `critical` / `high` / `medium` / `low`. **Informational metadata only** — `aqa-inspect` does NOT filter or select cases by priority. |
| `expected_result` | yes | `"pass"` for happy paths; `"fail"` for error paths — the error/validation state appearing is the expected normal behavior, so such a case is judged **pass** when the error is correctly displayed. |
| `test_data` | yes | `key: value` map. **Must always include `BASE_URL`** (the live service root, from `--target <url>`). Other keys are feature inputs (e.g. `email`, `password`). |
| `steps` | yes | Ordered list of step entries (see below). |
| `cleanup` | yes | Per-case cleanup actions; `- type: clear_cookies` is the default for every case. |

### Per step

| Field | Required | Meaning |
|---|---|---|
| `action` | yes | A **natural language** sentence describing the behavior (may contain `${key}` variables). The execution engine interprets it at runtime and resolves the matching browser commands — no pre-baked selectors. |
| `sensitive` | optional | `true` on steps that input passwords / tokens / secrets. Such values are masked as `****` in all logs, output, and reports. |

## Variable Substitution Rules

- Every `${key}` in a case's `action` strings is substituted from that case's
  own `test_data` map before the step is executed.
- `BASE_URL` must be present in **every** case's `test_data` — URLs in actions
  are written as `${BASE_URL}/path`, never hardcoded. Even if a full URL is
  provided as input, convert it to `${BASE_URL}` + path form.
- Keys whose names contain `password`, `secret`, `token`, etc. must have
  `sensitive: true` set on the step that inputs them.

## Compact Example

```yaml
name: "Login"
description: "User authentication flow"
tags: [auth, login]

cases:
  - case_id: login-001
    name: "Log in with valid credentials"
    priority: critical          # informational only — not used for filtering
    expected_result: "pass"
    test_data:
      BASE_URL: "https://app.example.com"
      email: "testuser@example.com"
      password: "TestPassword123!"
    steps:
      - action: "Navigate to ${BASE_URL}/login"
      - action: "Enter ${email} in the email field"
      - action: "Enter ${password} in the password field"
        sensitive: true
      - action: "Click the Sign in button and wait for page load"
      - action: "Verify the dashboard is visible"
    cleanup:
      - type: clear_cookies

  - case_id: login-002
    name: "Log in with wrong password"
    priority: high
    expected_result: "fail"     # the error appearing IS the expected behavior
    test_data:
      BASE_URL: "https://app.example.com"
      email: "testuser@example.com"
      password: "wrongpassword!!"
    steps:
      - action: "Navigate to ${BASE_URL}/login"
      - action: "Enter ${email} in the email field"
      - action: "Enter ${password} in the password field"
        sensitive: true
      - action: "Click the Sign in button"
      - action: "Verify an invalid-credentials error message is displayed"
    cleanup:
      - type: clear_cookies
```
