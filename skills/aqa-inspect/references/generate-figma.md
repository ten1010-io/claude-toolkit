# Generating `cases.yaml` from a Figma Design (`--figma <url>`)

This reference describes how `aqa-inspect` turns a `--figma <url>` into a draft
`cases.yaml` test plan. It is used when the user invokes `aqa-inspect` with a
Figma file or frame URL.

`cases.yaml` follows the **AQA scenario schema (Format A "cases:" structure)**
defined in `skills/aqa-run/SKILL.md`. The same schema is produced by the
live-URL path documented in `generate-explore.md`. Both paths emit identical
schema and follow the same `case_id` convention and the same mandatory human
review gate.

## Prerequisites

- `--figma <url>` — the Figma file or frame URL to analyze.
- `--figma-token <token>` — Figma Personal Access Token. Resolution order:
  this flag → `FIGMA_ACCESS_TOKEN` in `.env`/`.env.local`/shell env → ask the
  user. The Figma API rejects unauthenticated requests (403), so a token is
  always required.
- `--target <url>` — **required**. The live site the generated cases will run
  against. Without it there is no `BASE_URL` to anchor the steps, so refuse to
  proceed and ask the user for it.

## Step 1 — Analyze the Figma design

**Reuse the analysis procedure from `aqa-spec`.** Do not re-derive it here.
Follow the **"Figma Mode Workflow"** section of `skills/aqa-spec/SKILL.md`,
specifically:

- **F-0 Resolve Figma Access Token** — `--figma-token` flag first, then
  `FIGMA_ACCESS_TOKEN` (`.env`, `.env.local`, shell env), or ask the user.
- **F-1 Parse Figma URL** — extract `FILE_KEY` and optional `NODE_ID`.
- **F-2 Fetch Figma File Structure** — pull the file (and node) JSON via the
  Figma API.
- **F-3 Analyze Figma Design** — identify target frames, extract UI components
  (inputs, buttons, labels, error/success states, navigation, form structure),
  infer happy-path and error flows, and extract test-data hints from labels and
  placeholders.

That section is the single source of truth for *how* to read a Figma design.
This document only covers *what to emit afterward*: a `cases.yaml` shaped for
`aqa-inspect` execution.

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

## Step 2 — Derive candidate user flows → cases

From the analyzed components and inferred flows (F-3.3), enumerate candidate
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
| `test_data` | `key: value` map. Always includes `BASE_URL`. Derive other keys from F-3.4 test-data hints. |
| `steps` | Ordered list of `action` entries in natural language (multi-step). |
| `expected_result` | `"pass"` for happy paths, `"fail"` for error paths (the error appearing is the expected normal behavior). |

`BASE_URL` is taken from `--target <url>` and stored in **every** case's
`test_data`, exactly as in the `aqa-spec` Figma flow.

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

## Step 4 — Emit `cases.yaml` (Format A)

Fill the AQA Format A skeleton. The full schema lives in
`skills/aqa-run/SKILL.md` ("Format A: Cases Structure"); the abbreviated
skeleton below shows only what this path must populate:

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
  step (same rule as `aqa-spec`).
- `BASE_URL` is mandatory in every `test_data` block.
- `cleanup: clear_cookies` is the per-case default.

## Step 5 — MANDATORY human review before execution

**Do not skip this gate. Figma → cases is lossy and can hallucinate.**

A design frame does not reliably tell you real selectors, real validation
messages, or which flows actually exist on the live site. Treat the generated
`cases.yaml` as a **draft only**.

Before any execution:

1. Show the full drafted `cases.yaml` to the user.
2. Pause and let them confirm, edit, or cancel — the same review pattern as
   `aqa-spec`'s "F-6 Human-in-the-Loop Review".
3. Only after explicit human approval may the cases be executed.

`aqa-inspect` MUST NOT auto-run Figma-derived cases without this approval.
