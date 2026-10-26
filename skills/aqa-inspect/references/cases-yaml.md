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

login:                      # optional — only when the target requires auth
  path: "/login"            # login page path, relative to BASE_URL
  username_selector: "input[name=username]"
  password_selector: "input[name=password]"
  submit_text: "Sign in"    # regex source matched against the submit button name
  logout_text: "Sign out"   # regex source matched against the logout menu item
  id_key: auth_id           # test_data key holding the account id
  password_key: auth_password  # test_data key holding the password

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
| `login` | optional | Target-specific authentication config consumed by the `login` / `logout` ops and the IR compiler (see "File-level `login:` config" below). Generation MUST emit it whenever login credentials are involved — **no login path or form selector may ever be hardcoded in a driver or IR**. |
| `cases` | yes | List of test cases (see below). |

### File-level `login:` config

Everything target-specific about authentication lives here — the shipped
playwright driver (`run-case.mjs`) and the IR compiler (`compile.mjs`) read
this block and contain no app-specific values themselves. All keys are
optional with generic defaults:

| Key | Default | Meaning |
|---|---|---|
| `path` | `/login` | Login page path, relative to `BASE_URL`. Also used to detect redirect-to-login URL asserts (they get an auto-waiting settle assert in the IR). |
| `username_selector` | `input[name=username]` | CSS selector of the account-id field. |
| `password_selector` | `input[name=password]` | CSS selector of the password field. Also the settle anchor: the IR asserts it `hidden` after login and `visible` on redirect-to-login asserts. |
| `submit_text` | `Sign in\|Log in\|Login` | Regex source matched (case-insensitive) against the submit button's accessible name. |
| `logout_text` | `Sign out\|Log out\|Logout` | Regex source matched against the logout menu item, for the `logout` op. |
| `id_key` / `password_key` | `auth_id` / `auth_password` | `test_data` keys holding the credentials. `password_key` becomes the IR's `value_ref` — the literal secret never appears in any generated file. |

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

## Machine op fields (deterministic execution)

Each step MAY additionally carry a machine `op` field plus its operands. The
`action` sentence stays the human-readable truth; `op` is what the shipped
playwright driver (`references/run-case.mjs`) executes and what
`references/compile.mjs` compiles into the offline IR. **The playwright engine
requires `op` on every step** — generation emits both together; a step without
`op` cannot be executed deterministically (the browser-use engine interprets
`action` directly and ignores `op`).

| `op` | Operands | Meaning |
|---|---|---|
| `login` | — (uses file-level `login:` + `test_data` creds) | Authenticate. The driver logs in once per account and reuses the session; the IR expands to goto → fill id → fill password (`value_ref`) → click submit → assert password field `hidden` (settles the redirect). |
| `logout` | — | Open the account menu and click the item matching `login.logout_text`. Live-only (no IR form). |
| `goto` | `value` (URL, `${key}` substituted) | Navigate and wait for load + network idle. |
| `fill` | `selector`, `value`, `sensitive?` | Fill a field. Sensitive values are masked `****` and become `value_ref` in the IR. |
| `click` | `selector` | Click the described element. |
| `click_text` | `value` (exact visible text) | Click by exact text match. |
| `download` | `selector` or `value` (button text) | Click and require a download event to fire. Compiles to the click only. |
| `assert_text` | `expect` | Page body contains the text. Compiles to `text_contains` on `body` (strict-safe — never a bare text selector). |
| `assert_not_text` | `expect` | Page body does not contain the text. |
| `assert_url` | `expect` (substring) | Current URL contains the substring. When `expect` targets `login.path`, the IR prepends a `visible` assert on the login form to settle the redirect. |
| `assert_visible` | `selector` | Element is visible. |
| `assert_attr` | `selector`, `attr`, `expect` | Attribute equals (substring for `href`). Compiles to a CSS attribute selector + `visible` — IR v2 has no `attr_equals`. |
| `manual` | `note` (specific blocker) | Not automatable — recorded as `needs_discussion` with `note` as the `discuss_note`. Subject to the automation-first mandate in `SKILL.md`: the note must name a concrete blocker. |

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
