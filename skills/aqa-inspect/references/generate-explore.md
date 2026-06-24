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

## Step 1 — Open the target (and authenticate if required)

Open `--target <url>` with the selected automation engine:

- **browser-use engine:** `open "<url>"`
- **Playwright engine:** `page.goto("<url>")`

Wait for the page to settle (load / network idle) before inspecting.

**Authentication (from SKILL.md Step 1.5):** if the run was marked as requiring login, perform the login flow with the resolved credentials **before** any inspection — locate the email/ID and password fields, fill them, submit, and verify the authenticated state. Only then proceed to Step 2. Mask the password as `****` in every log line and status message.

**Login-wall fallback:** if login was NOT marked as required but the opened page is a login wall (redirect to a login path, or a password field gating the content), pause, ask the user for credentials (per SKILL.md Step 1.5 resolution order), log in, then continue exploring.

### Step 1a — Scope: confirm WHICH areas to QA before exhaustive coverage

**Do not exhaustively enumerate the whole site before confirming scope.** A live
app can span dozens of routes; QAing every one when the user cares about a single
feature wastes a long run and buries the relevant cases. Confirm scope first, then
go deep — scope narrows WHICH areas are covered, never how thoroughly each
confirmed area is covered.

Required procedure:

1. **Shallow enumeration first.** From the opened page, discover only the
   top-level surface: primary nav items, sidebar/menu entries, top-level routes,
   and the main page sections. Do **not** crawl into detail pages, modals, or
   sub-tabs yet — that is the exhaustive pass (Step 3), which runs only after
   scope is confirmed.
2. **Honor any free-text scope hint from intake.** If the user gave a scope hint
   at intake (passed from SKILL.md — e.g. "just the signup flow", "only the admin
   area"), use it to pre-narrow: pre-select the matching areas as the proposed
   default instead of all.
3. **Present the discovered areas and confirm scope.** Show the user the
   shallow-enumerated areas and let them choose which to QA — **multi-select**,
   with the **default = the widest scope (all discovered areas)**. Use
   `AskUserQuestion` (with `multiSelect`) where available; otherwise present a
   numbered list and ask them to pick. When in doubt, propose full coverage and
   let them prune — never silently narrow on your own.
4. The confirmed set of areas is the **scope** for the rest of this path. The
   exhaustive coverage mandate (Step 3) applies only within it.

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

## Step 3 — Derive cases (MAXIMIZE COVERAGE)

> **Coverage is the primary goal. Time is NOT a constraint.** Within the scope
> confirmed in Step 1a, generate as MANY cases as the surface area justifies — a
> thorough sheet for a real app is typically **dozens to well over a hundred**
> cases, not a handful. Never stop at "a few happy paths plus two negatives."
> Under-generating is the most common failure of this step; err heavily toward
> MORE cases. Do not silently cap, sample, or "pick the important ones" —
> enumerate the whole of the confirmed scope. (Scope narrows WHICH areas are
> covered, not how thoroughly each confirmed area is covered.)

### 3a. Enumerate the WHOLE confirmed scope first (breadth)

Within the areas confirmed in Step 1a, do not test only the landing page. Crawl
and list **every reachable destination inside the confirmed scope** before
writing cases:

- **Every route / page** reachable from the nav, sidebar, menus, breadcrumbs,
  and in-page links within scope (and, for authed apps, every admin/management
  route in scope).
- **Every list/table** and its **detail** pages (open a representative row).
- **Every create / edit form** and modal/dialog/drawer.
- **Every tab, sub-tab, and view toggle** within each page.

Each distinct page, detail view, dialog, and tab is its own group of cases.

### 3b. Decompose each destination into MANY cases (depth)

For every page/flow, do NOT write a single "page loads" case. Break it into
field-, control-, and state-level cases. At minimum, per destination, cover:

- **Render checks** — each major section/heading is present; each **table
  column header** is present (enumerate them explicitly, not "columns render");
  key rows/values render.
- **Every field** — one case (or more, with negatives) per input, select,
  checkbox, radio, textarea, toggle, slider, and date/month picker. Do NOT
  collapse a form into a single "fill the form" case — each field is exercised
  on its own (valid value, then its negative/boundary cases per the list below).
- **Every interactive control** — each button, link, tab, toggle, dropdown,
  date/month picker, sort control, filter. One case per control (open it,
  verify its options/behavior). For destructive controls, see the safety note.
- **Every popup / overlay** — each modal, dialog, drawer, confirm/alert popup,
  tooltip, toast/snackbar, dropdown menu, context (right-click) menu, and
  popover gets its OWN case: a case to **trigger it open** and verify its
  content, and a **separate** case for each exit path (close button, backdrop
  click, Esc, confirm, cancel). Enumerate every trigger that opens an overlay —
  never assume "the modal works" from one open case.
- **Every action / interaction type** — beyond clicks: hover-reveal, drag &
  drop, expand/collapse, copy-to-clipboard, file upload, download, submit, and
  keyboard interactions (Enter to submit, Esc to close, Tab order). One case
  each.
- **Search / filter / sort** — a matching query, a **no-match** query (empty
  state), each filter dropdown's options, each sortable column.
- **Pagination** — controls present; page-size selector; next/prev where data
  allows.
- **Full CRUD** wherever a create path exists — **C**reate (happy), **R**ead
  (it appears in the list + detail opens), **U**pdate (edit a field, save,
  verify persisted), **D**elete (remove + verify gone, as cleanup). Treat
  Create/Read/Update/Delete as **separate cases**, not one.
- **Negative & boundary cases** — empty required field, invalid format,
  duplicate value, too-long / special-character input, whitespace-only — each
  its own case whose final step verifies the validation error/blocked state.
  See `cases-yaml.md` "Negative scenarios" for how to encode error paths.
- **Auth / session / security** where applicable — valid login, wrong password,
  unknown user, empty fields, session-persists-on-reload, and
  **unauthenticated access to a protected route redirects to login**.
- **Cross-cutting** — nav routing for every menu item, sidebar collapse/expand,
  page title, notifications, logout.

### 3c. Safety on shared / production-like targets

Maximizing coverage must never mean damaging shared state. For mutating
controls (Delete, Drain, Cordon, reset, reclaim, transfer, role changes, bulk
ops, downloads that bill, etc.) on data you did not create:

- Prefer a **throwaway resource** you create and then delete for full CRUD.
- When no safe throwaway exists, write the case as **presence-verified only**
  ("verify the Delete button is present; DO NOT click it") rather than dropping
  coverage. Note the limitation in the case `name`.

Each case carries these fields:

| Field | Meaning |
|---|---|
| `case_id` | Stable slug — see "case_id convention" below. |
| `name` | Human-readable case title (becomes the Jira summary downstream). |
| `steps` | Ordered list of `action` entries in natural language (multi-step). A case is judged purely by whether its steps succeed; negative/error scenarios are encoded by making the FINAL step verify the error/blocked state. |
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
        selector:
          strategy: role
          role: button
          name: "Create account"
        selector_anchor: "Create account"
      - action: "Verify the account-created confirmation is visible"
    cleanup:
      - type: clear_cookies

  - case_id: signup-002
    name: "Sign up with empty required email"
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

### Harvest selectors while exploring

Exploration already inspects the live DOM. For each step whose target element
was located during exploration, emit a `selector` descriptor (and
`selector_anchor` when a stable visible text exists) per the schema in
`cases-yaml.md`, using the preference order `role`+`name` > `label` > `text` >
`css`. This pre-warms the cache so the **first** execution is already fast.
Steps whose element could not be confidently located are left without a
`selector` (execution fills them on run 1). Never put a `sensitive` value into a
descriptor.

Notes:

- **Language:** write every case `name` and every `steps[].action` in the
  **user's language** (the language the user is conversing in), per the Language
  rule in `SKILL.md`. The English `name`/`action` text in the skeleton above is
  a reference only — translate it. `case_id` slugs stay lowercase ASCII; YAML
  keys stay in English.
- Mark password / token / secret inputs with `sensitive: true` on the relevant
  step.
- `BASE_URL` (from `--target <url>`) is mandatory in every `test_data` block.
- `cleanup: clear_cookies` is the per-case default.
- **Authenticated targets:** when the run requires login, every generated case
  must be independently executable — inject `auth_email` / `auth_password` into
  each case's `test_data`, prepend the login steps (navigate to the login page,
  enter `${auth_email}`, enter `${auth_password}` with `sensitive: true`,
  submit, verify the authenticated state) before the case's own steps, and keep
  `cleanup: clear_cookies` so sessions never leak between cases. When showing
  the drafted `cases.yaml` for review, display the password value as `****`.

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
