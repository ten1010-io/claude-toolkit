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
| `test_data` | yes | `key: value` map. **Must always include `BASE_URL`** (the live service root, from `--target <url>`). Other keys are feature inputs (e.g. `email`, `password`). |
| `steps` | yes | Ordered list of step entries (see below). |
| `cleanup` | yes | Per-case cleanup actions; `- type: clear_cookies` is the default for every case. |

### Negative scenarios (no `expected_result` field)

There is **no `expected_result` field.** A case encodes its full expectation in
its steps — a case passes when every step succeeds and fails when any step
fails. This applies to negative/error scenarios too: express the expected
error or blocked state as the **final verification step**, written so that the
correct behavior makes it succeed. Examples:

- "wrong password" → final step *"Verify an invalid-credentials error message is
  displayed"* (succeeds when the error shows).
- "empty required field blocks submit" → final step *"Verify the Create button
  is disabled"* (succeeds when it is disabled).

Never write a case that relies on a step *throwing* to mean "pass" — the blocked
state must be asserted positively. (This keeps the live-engine verdict and the
offline `aqa-runner` verdict identical: both judge purely on step success.)

### Per step

| Field | Required | Meaning |
|---|---|---|
| `action` | yes | A **natural language** sentence describing the behavior (may contain `${key}` variables). The execution engine interprets it at runtime and resolves the matching browser commands — no pre-baked selectors. |
| `sensitive` | optional | `true` on steps that input passwords / tokens / secrets. Such values are masked as `****` in all logs, output, and reports. |
| `selector` | optional | **Machine-managed** structured locator cache for this step (not human-authored). Engine-neutral descriptor with a `strategy` discriminator (`role`/`label`/`text`/`css`) and the matching keys. Populated by generation harvest and/or first-run execution; reused on rerun/resume. Absent ⇒ the engine resolves the step from `action` at runtime, as before. |
| `selector_anchor` | optional | Expected visible text on the targeted element, used as a heal trigger and false-positive guard when a cached `selector` is reused. Never contains a `sensitive` value. |

## Variable Substitution Rules

- Every `${key}` in a case's `action` strings is substituted from that case's
  own `test_data` map before the step is executed.
- `BASE_URL` must be present in **every** case's `test_data` — URLs in actions
  are written as `${BASE_URL}/path`, never hardcoded. Even if a full URL is
  provided as input, convert it to `${BASE_URL}` + path form.
- Keys whose names contain `password`, `secret`, `token`, etc. must have
  `sensitive: true` set on the step that inputs them.

## Selector Cache (machine-managed)

`selector` is an **optional, machine-managed** cache — never required from a
human author. It lets the execution engines skip natural-language locator
resolution on reruns. The contract is *no human-authored selectors*; a learned
cache is a different thing and is allowed here.

### Descriptor shape

```yaml
selector:
  strategy: role        # one of: role | label | text | css
  role: button          # strategy=role  → role + name
  name: "Sign in"
  # label: "Email"      # strategy=label
  # text: "Sign in"     # strategy=text
  # css: "button.primary"  # strategy=css (last resort, low confidence)
selector_anchor: "Sign in"   # optional expected visible text
```

Learning preference order (most to least stable): `role`+`name` > `label` >
`text` > `css`.

### Rules

- **Optional + backward compatible.** A step with no `selector` behaves exactly
  as a step did before this field existed.
- **`${var}` substitution applies** to `selector` values (e.g. a `name`
  containing `${orderId}`) identically to `action` — store the placeholder
  verbatim and substitute at execution time.
- **`sensitive` values never appear** in `selector` or `selector_anchor`; store
  only field identifiers (a password field is `{strategy: role, role: textbox,
  name: Password}`).
- **Who fills it:** generation harvest (live-DOM paths) and/or first-run
  execution write-back. A fresh regeneration produces a new `cases.yaml` and
  re-harvests — stale selectors are not inherited.

## Compact Example

```yaml
name: "Login"
description: "User authentication flow"
tags: [auth, login]

cases:
  - case_id: login-001
    name: "Log in with valid credentials"
    priority: critical          # informational only — not used for filtering
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
        selector:
          strategy: role
          role: button
          name: "Sign in"
        selector_anchor: "Sign in"
      - action: "Verify the dashboard is visible"
    cleanup:
      - type: clear_cookies

  - case_id: login-002
    name: "Log in with wrong password"
    priority: high              # negative case: the final step asserts the error state
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
