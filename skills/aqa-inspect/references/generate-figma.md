# Generating `cases.yaml` from a Figma Design (`--figma <url>`)

This reference describes how `aqa-inspect` turns a `--figma <url>` into a draft
`cases.yaml` test plan. It is used when the user invokes `aqa-inspect` with a
Figma file or frame URL.

`cases.yaml` follows the **authoritative schema in
`references/cases-yaml.md`**. The same schema is produced by the live-URL path
documented in `generate-explore.md`. Both paths emit identical schema and follow
the same `case_id` convention and the same mandatory human review gate.

## Prerequisites

- `--figma <url>` — the Figma file or frame URL to analyze.
- `--figma-token <token>` — Figma Personal Access Token (resolution order in
  Step 1). The Figma API rejects unauthenticated requests (403), so a token is
  always required.
- `--target <url>` — **required**. The live site the generated cases will run
  against. Without it there is no `BASE_URL` to anchor the steps, so refuse to
  proceed and ask the user for it (question prompt, Round 2 of SKILL.md's
  question batching rule).
- Auth outcome from SKILL.md Step 1.5 — when the target requires login, inject
  `auth_email` / `auth_password` into every generated case's `test_data`,
  prepend login steps (password step `sensitive: true`), and display the
  password as `****` in the review output. Same rules as
  `generate-explore.md`'s "Authenticated targets" note.

## Step 1 — Analyze the Figma design

### Step 1.1 — Resolve the Figma access token

Resolve the token in this priority order:

1. The `--figma-token <token>` flag, if passed.
2. `FIGMA_ACCESS_TOKEN` in `.env` in the current working directory.
3. `FIGMA_ACCESS_TOKEN` in `.env.local`.
4. Shell environment: `echo $FIGMA_ACCESS_TOKEN`.

If none are found, ask the user via a **question prompt** (AskUserQuestion where available — Round 2 of SKILL.md's question batching rule, bundled with the auth-credential questions when both apply), explaining where to get one:

> "I need a Figma Personal Access Token to fetch the design file.
> You can generate one at: Figma → Profile → Settings → Security → Personal access tokens
> Please paste your token."

Store the resolved value as `FIGMA_TOKEN` for all subsequent API calls. Mask it as `****` in logs and output.

### Step 1.2 — Parse the Figma URL

Extract the file key and optional node ID from the provided Figma URL:

```
# File URL
https://www.figma.com/file/{FILE_KEY}/{title}

# Design URL (with node)
https://www.figma.com/design/{FILE_KEY}/{title}?node-id={NODE_ID}

# Prototype URL
https://www.figma.com/proto/{FILE_KEY}/{title}?node-id={NODE_ID}
```

- Extract `FILE_KEY` (always present).
- Extract `NODE_ID` from the `?node-id=` query param if present — it is the
  **entry point** for scope discovery (see Step 1a; never the boundary).
- URL-decode the node ID if needed (e.g., `123-456` and `123%3A456` are both
  valid forms).

### Step 1.3 — Fetch the Figma file structure

Fetch via the Figma REST API with the token in the `X-Figma-Token` header:

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

- `"Invalid token"` → ask the user for a new token.
- `"Not found"` → tell the user the file is not accessible (private or wrong
  URL).
- Other errors → show the raw error message and stop.

Scope and request sizing for these fetches are governed by Step 1a and
Step 1b below — read them before fetching anything beyond the shallow
structure listing.

### Step 1a — Scope: a node-id is an entry point, NOT the boundary

**Do not generate cases from only the node in the URL.** A `node-id` in a
shared Figma link usually points at one frame (often a single annotation), but
the user's intent is almost always the *feature or file* that frame belongs to.
Generating from one frame silently produces a tiny, misleading case set.

Required procedure:

1. Fetch the file's page/section structure first (shallow):
   `GET /v1/files/{FILE_KEY}?depth=2` — this is small even for huge files.
2. Enumerate the feature areas: SECTION nodes (e.g. `Job_List`, `Job_Create`)
   and annotation/policy frames (names like `화면 정의`, `정책`, `[ D ] ...`,
   "spec", "policy"). These annotation frames carry the richest testable rules.
3. **Present the discovered structure to the user and confirm scope**: the
   single linked node, one feature area, or the full page/file.
   Default to the **widest scope the user confirms** — when in doubt, propose
   full coverage and let them prune. Never silently default to node-only.
4. Extract TEXT node contents per area (design JSON is huge; the policy text is
   what matters). Analyze text, not raw geometry.

### Step 1b — Figma API rate limits (cost-based)

The Figma API uses **cost-based rate limiting** — one giant request can exhaust
the budget for many minutes (observed: two ~80MB section fetches → 429 for
15+ minutes). Rules:

- **Never fetch whole SECTION nodes blindly** — sections containing component
  instances can be 50–100MB each. Prefer the small annotation/policy frames
  found in Step 1a, fetched **one node per request**.
- Always pass `geometry=none`. Use `depth` for structure listing.
- Cache every successful response to disk before parsing; never re-fetch what
  you already have.
- On `429`: back off 60–120s and retry. On `400 Request too large`: split into
  per-node requests — do not retry the same oversized request.
- Long waits are normal; run retries in the background and continue other work
  (e.g. drafting cases from already-fetched areas) while waiting.

### Step 1.4 — Analyze the design

Read the fetched JSON (`/tmp/figma_file.json`, plus `/tmp/figma_nodes.json` and
any per-area node fetches) and extract:

#### Identify target frame(s)

- Within the scope confirmed in Step 1a, focus on the relevant frames and
  components.
- If only a `NODE_ID` scope was confirmed: focus on that specific
  frame/component; otherwise analyze the confirmed feature areas.

#### Extract UI components

| Component type | Detection criteria |
|---|---|
| **Input fields** | `TEXT` inside frame with input-style fills, or component name containing "input", "field", "text" |
| **Buttons** | `FRAME` or `COMPONENT` with name containing "button", "btn", "cta", "submit" |
| **Labels / Headings** | `TEXT` nodes with large font size or bold weight |
| **Error states** | frames or components named with "error", "warning", "invalid", "fail" |
| **Success states** | frames or components named with "success", "confirm", "complete" |
| **Navigation elements** | links, tabs, breadcrumbs, back buttons |
| **Form structure** | grouping of inputs + submit button = a form |

If component names are generic (e.g., "Frame 12", "Rectangle 5"), rely on
visual structure (position, size, fill) to infer the component type.

#### Infer user flows

1. **Happy path**: fill inputs → click submit → see success state.
2. **Error paths**: trigger error states (e.g., empty form → error message;
   invalid format → validation error).

#### Extract test-data hints

From label and placeholder text:

- Input field labels → test data keys (e.g., "Email" → `email`, "Password" →
  `password`).
- Placeholder text → example test data values.
- Fall back to defaults: `testuser@example.com`, `TestPassword123!`.

## Step 2 — Derive candidate user flows → cases

From the analyzed components and inferred flows, enumerate candidate
**user flows** and turn each into one case:

- **Happy path** per primary flow: fill inputs → submit → see success state.
- **Error paths** per identified error state: empty required field, invalid
  format, mismatch, etc.

Each case carries these fields:

| Field | Meaning |
|---|---|
| `case_id` | Stable slug — see "case_id convention" below. |
| `name` | Human-readable case title (becomes the Jira summary downstream). |
| `priority` | `critical` / `high` / `medium` / `low`. **Informational only** — `aqa-inspect` does **not** filter or select cases by priority. It is metadata for the human reader. |
| `test_data` | `key: value` map. Always includes `BASE_URL`. Derive other keys from the test-data hints extracted in Step 1.4. |
| `steps` | Ordered list of `action` entries in natural language (multi-step). |
| `expected_result` | `"pass"` for happy paths, `"fail"` for error paths (the error appearing is the expected normal behavior). |

`BASE_URL` is taken from `--target <url>` and stored in **every** case's
`test_data`.

## Step 3 — `case_id` convention

`case_id` is a **stable slug**: a lowercase feature prefix plus a zero-padded
sequence number, e.g. `login-001`, `login-002`, `checkout-007`. This matches the
`case_id` column documented in `references/results-csv.md`.

The slug must be stable across regenerations because it is the join key for:

- **rerun match** — re-running only the cases that previously failed.
- **Jira dedup** — `aqa-jira` keys tickets off `case_id` so the same case does
  not spawn duplicate issues.

Do not renumber or rename a `case_id` once it has been reviewed and run. New
cases get new trailing numbers; they never reuse a retired id.

## Step 4 — Emit `cases.yaml`

Fill the schema skeleton. The full schema lives in
`references/cases-yaml.md`; the abbreviated skeleton below shows only what this
path must populate:

```yaml
name: "Login"
description: "User authentication flow drafted from Figma"
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
    priority: high              # informational only — not used for filtering
    expected_result: "fail"
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

Notes:

- Mark password / token / secret inputs with `sensitive: true` on the relevant
  step (see the substitution rules in `references/cases-yaml.md`).
- `BASE_URL` is mandatory in every `test_data` block.
- `cleanup: clear_cookies` is the per-case default.

## Step 5 — MANDATORY human review before execution

**Do not skip this gate. Figma → cases is lossy and can hallucinate.**

A design frame does not reliably tell you real selectors, real validation
messages, or which flows actually exist on the live site. Treat the generated
`cases.yaml` as a **draft only**.

Before any execution:

1. Show the full drafted `cases.yaml` to the user.
2. Pause and let them confirm, edit, or cancel.
3. Only after explicit human approval may the cases be executed.

`aqa-inspect` MUST NOT auto-run Figma-derived cases without this approval.
