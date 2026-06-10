# Generating `cases.yaml` by Exploring a Live URL (`--target <url>`, no Figma)

This reference describes how `aqa-inspect` auto-drafts a `cases.yaml` test plan
by exploring a live site directly, when the user provides a `--target <url>`
but **no** `--figma <url>`.

`cases.yaml` follows the **authoritative schema in
`references/cases-yaml.md`** — the same schema produced by the
Figma path in `generate-figma.md`. Both paths use the identical schema, the
same `case_id` slug convention, and the same mandatory human review gate.

## Prerequisites

- `--target <url>` — **required**. The live site to explore. It is stored as
  `BASE_URL` in every generated case's `test_data`.
- No `--figma` argument. If both are present, the Figma path
  (`generate-figma.md`) takes precedence and this path is not used.

## Step 1 — Open the target

Open `--target <url>` with the selected automation engine:

- **browser-use engine:** `open "<url>"`
- **Playwright engine:** `page.goto("<url>")`

Wait for the page to settle (load / network idle) before inspecting.

## Step 2 — Inspect the DOM / accessibility tree

Enumerate the interactive surface of the page from the **DOM** and the
**accessibility tree**:

- **Forms** — each `<form>` or logical form grouping.
- **Inputs** — text, email, password, number, checkbox, radio, select,
  textarea. Note their labels (accessible name) and placeholders.
- **Required fields** — `required` attribute, `aria-required="true"`, or
  visually marked mandatory fields.
- **Buttons** — submit buttons, primary CTAs, secondary actions.
- **Links and navigation** — primary nav, in-page links, breadcrumbs, tabs.
- **Visible flows** — group the above into candidate user flows (e.g. a form
  with inputs + a submit button is one flow).

Prefer the accessibility tree for stable, human-meaningful element names
(accessible name + role); fall back to DOM attributes (id, name, label `for`)
when the accessibility name is missing.

## Step 3 — Derive cases

For each primary form / flow discovered, derive at least:

- **One happy path** — fill all fields with valid data, submit, verify the
  success outcome.
- **Obvious negative cases**, at minimum:
  - **Empty required field** — leave a required field blank and submit; expect a
    validation error.
  - **Invalid input** — supply a malformed value (e.g. `not-an-email` in an
    email field) and submit; expect a validation error.

Each case carries these fields:

| Field | Meaning |
|---|---|
| `case_id` | Stable slug — see "case_id convention" below. |
| `name` | Human-readable case title (becomes the Jira summary downstream). |
| `steps` | Ordered list of `action` entries in natural language (multi-step). |
| `expected_result` | `"pass"` for happy paths, `"fail"` for negative cases (the validation error appearing is the expected normal behavior). |
| `test_data` | `key: value` map. Always includes `BASE_URL`; other keys derived from the discovered field labels/placeholders. |

`priority` is optional metadata; if emitted it is **informational only** and is
not used by `aqa-inspect` to filter or select cases.

## Step 4 — `case_id` convention

`case_id` is a **stable slug**: a lowercase feature/flow prefix plus a
zero-padded sequence number, e.g. `signup-001`, `signup-002`, `contact-003`.
This is the same convention as `generate-figma.md` and matches the `case_id`
column in `references/results-csv.md`.

The slug must stay stable across regenerations because it is the join key for
**rerun match** (re-running previously failed cases) and **Jira dedup**
(`aqa-jira` keys tickets off `case_id`). Never renumber or reuse a retired id.

## Step 5 — Emit `cases.yaml`

Fill the schema skeleton. The full schema lives in
`references/cases-yaml.md`; the abbreviated
skeleton below shows only what this path must populate:

```yaml
name: "Signup"
description: "Signup flow drafted from live-URL exploration"
tags: [auth, signup]

cases:
  - case_id: signup-001
    name: "Sign up with valid details"
    expected_result: "pass"
    test_data:
      BASE_URL: "https://app.example.com"
      email: "testuser@example.com"
      password: "TestPassword123!"
    steps:
      - action: "Navigate to ${BASE_URL}/signup"
      - action: "Enter ${email} in the email field"
      - action: "Enter ${password} in the password field"
        sensitive: true
      - action: "Click the Create account button and wait for page load"
      - action: "Verify the account-created confirmation is visible"
    cleanup:
      - type: clear_cookies

  - case_id: signup-002
    name: "Sign up with empty required email"
    expected_result: "fail"
    test_data:
      BASE_URL: "https://app.example.com"
      password: "TestPassword123!"
    steps:
      - action: "Navigate to ${BASE_URL}/signup"
      - action: "Leave the email field empty"
      - action: "Enter ${password} in the password field"
        sensitive: true
      - action: "Click the Create account button"
      - action: "Verify a required-field validation error is displayed for email"
    cleanup:
      - type: clear_cookies

  - case_id: signup-003
    name: "Sign up with invalid email format"
    expected_result: "fail"
    test_data:
      BASE_URL: "https://app.example.com"
      email: "not-an-email"
      password: "TestPassword123!"
    steps:
      - action: "Navigate to ${BASE_URL}/signup"
      - action: "Enter ${email} in the email field"
      - action: "Enter ${password} in the password field"
        sensitive: true
      - action: "Click the Create account button"
      - action: "Verify an invalid-email validation error is displayed"
    cleanup:
      - type: clear_cookies
```

Notes:

- Mark password / token / secret inputs with `sensitive: true` on the relevant
  step.
- `BASE_URL` (from `--target <url>`) is mandatory in every `test_data` block.
- `cleanup: clear_cookies` is the per-case default.

## Step 6 — MANDATORY human review before execution

**Do not skip this gate.** Auto-exploration infers intent from the DOM and the
accessibility tree; it can misread a field's purpose, miss a hidden step, or
guess the wrong validation behavior. Treat the generated `cases.yaml` as a
**draft only**.

Before any execution:

1. Show the full drafted `cases.yaml` to the user.
2. Pause and let them confirm, edit, or cancel — the same review pattern as
   `generate-figma.md`'s "Step 5 — MANDATORY human review".
3. Only after explicit human approval may the cases be executed.

`aqa-inspect` MUST NOT auto-run exploration-derived cases without this approval.
