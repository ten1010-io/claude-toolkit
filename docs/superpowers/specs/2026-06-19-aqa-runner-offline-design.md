# aqa-runner — Offline Deterministic Test Runner (Design Spec)

**Date:** 2026-06-19
**Status:** Approved (brainstorming complete)
**Repos:** `ten1010-io/claude-toolkit` (existing, producer) + `ten1010-io/aqa-runner` (new, consumer)

## Problem

`aqa-inspect` generates and runs `cases.yaml`, where every step is a
**natural-language** `action` (e.g. `"Click the Sign in button"`,
`"Verify the dashboard is visible"`). Executing those steps requires an LLM
(Claude Code) to resolve, per step, the **operation** (click vs fill vs goto),
the **locator**, and the **assertion**. The optional `selector` cache speeds up
only locator resolution on reruns — the operation type and the assertion are
still interpreted by the orchestrator (Claude) every run.

Consequence: `cases.yaml` cannot be executed without Claude Code.

The company operates in a **fully air-gapped** network (no npm, no external
download, no Claude). `aqa-inspect` is used only on internet-connected local dev
machines. The team needs a way to take QA scenarios authored locally and run
them **inside the air-gap, on each user's own PC, with zero LLM**.

## Goal

A standalone runner — `aqa-runner` — that reads a **deterministic, structured**
form of the test cases and executes it with Playwright, requiring no LLM and no
network. Distributed as a self-contained, per-OS bundle that an end user (not
necessarily a developer) unzips and double-clicks.

## Core Idea — "compile by recording a successful run"

The natural-language steps must be **compiled** to a deterministic structured
form while Claude is available (local dev). The compile is not a separate
analysis pass — it is a **byproduct of a normal `aqa-inspect` live run**: when
Claude executes a case successfully against the real site, it has already
decided the operation, the locator, and the assertion for every step. Those
decisions are emitted as the compiled IR.

```
[Local dev, Claude available]                 [Air-gapped customer PC]
claude-toolkit / aqa-inspect                   aqa-runner (downloaded bundle)
  run cases.yaml against live site               portable Node + run.js
  (Claude resolves op/locator/assert)            + node_modules + Chromium
        │                                              ▲
        │ record successful run → compile              │ download + unzip + double-click
        ▼                                              │
  cases.compiled.yaml  ──────── file transfer ────────►┘
  (deterministic IR, no LLM needed)
```

## Hard Boundary (the defining constraint)

`aqa-runner` runs **only** the compiled IR.

| Input file | Behavior |
|---|---|
| `cases.compiled.yaml` (IR, has `ir_version`) | ✅ executed |
| raw `cases.yaml` (natural-language `action:`) | ❌ rejected with a clear error: "not compiled — compile locally with aqa-inspect first" |

Detection: presence of `ir_version` at the top level ⇒ IR. Presence of
`action:` strings in steps ⇒ raw, reject.

Compilation requires at least one **live** run against the real target — a
`cases.yaml` generated from Figma but never executed has no resolved
operations/selectors and therefore cannot be compiled.

## IR Schema (the contract)

**Authoritative source:** `aqa-runner` repo (`schema/ir.md`). The compile step in
`claude-toolkit` targets this schema. `ir_version` lets the runner reject
incompatible files.

```yaml
ir_version: 1
name: "Login"
description: "User authentication flow"
cases:
  - case_id: login-001
    name: "Log in with valid credentials"
    expected_result: pass          # pass | fail (error-state-is-expected cases)
    steps:
      - op: goto
        url: "https://app.example.com/login"
      - op: fill
        selector: { strategy: role, role: textbox, name: "Email" }
        value: "testuser@example.com"
      - op: fill
        selector: { strategy: role, role: textbox, name: "Password" }
        value_ref: "password"      # sensitive → injected at run time, never baked in
        sensitive: true
      - op: click
        selector: { strategy: role, role: button, name: "Sign in" }
      - op: assert
        assert: { type: visible, selector: { strategy: text, text: "Dashboard" } }
    cleanup:
      - type: clear_cookies
```

### Finite op set (deterministic)

`goto` · `fill` · `click` · `select` · `check` · `hover` · `press` · `assert`

### Finite assert types (deterministic)

`visible` · `hidden` · `text_contains` · `url_matches` · `enabled` · `disabled`
· `value_equals` · `count`

### Selector descriptor

Reuses the existing `aqa-inspect` descriptor shape (`cases-yaml.md`):
`{ strategy: role|label|text|css, ... }`, preference order
`role`+`name` > `label` > `text` > `css`.

### Rules

- Unknown `op` or `assert.type`, or a missing required field ⇒ **hard error**
  for that case (`fail` + reason). Never silently skip or pass.
- `ir_version` mismatch with the runner ⇒ refuse the whole file with a clear
  version message.
- **Sensitive values are never baked into the IR.** A `sensitive` step carries a
  `value_ref` (a key name), not the secret. The secret is injected at run time
  from a separate input file (e.g. `secrets.env`), and masked as `****` in all
  logs, `results.csv`, and `report.html`.

## Runner (`aqa-runner` repo, fixed code)

- `run.js` — reads `cases.compiled.yaml`, drives a Chromium page via Playwright,
  executing each `op` directly. **No natural-language interpretation, no LLM,
  no network.**
- **Output is identical to the existing toolkit:** `results.csv` (schema in
  `results-csv.md`) + `report.html`. This keeps downstream `aqa-jira` working
  unchanged when results are carried back out.
- **No `needs_discussion`.** That status depends on LLM judgment, which is
  absent offline. Outcomes are **pass / fail only**. An unsupported or
  malformed step ⇒ `fail` with reason.
- Per-case isolation: each case runs in its own browser context (cookies/storage
  isolated), matching the existing Playwright engine.
- `expected_result` reconciliation matches the existing engine: a `fail`-typed
  case passes when the expected error/validation state appears.

## Packaging (GitHub Actions)

- **Trigger:** push a git tag `v*` → create a GitHub Release.
- **Matrix:** `windows-x64`, `macos-x64` (Intel), `macos-arm64` (Apple Silicon).
  Real OS runners ⇒ Playwright browsers and Node are the correct platform build.
- **Per job:** `npm ci` → `playwright install chromium` → fetch the matching
  portable **official Node** binary → assemble `run.js` + `node_modules` +
  Chromium + launcher (`run.bat` on Windows, `run.command` on macOS) into a zip
  → upload as a Release asset.
- **Why portable official Node (option A), not a compiled single-exe:** an
  unsigned custom `.exe`/binary triggers Windows SmartScreen / macOS Gatekeeper
  blocks, which are worse in an air-gap and complicate the security intake
  review. The official Node binary is already signed, and a plain-JS runner is
  readable for the customer's import/security review.
- **Customer-site flow:** download the OS-matching zip from Releases → unzip →
  drop in `cases.compiled.yaml` (+ `secrets.env` if needed) → double-click the
  launcher. No install step.
- Bundle size is ~200 MB/OS (Chromium dominates); accepted as inherent to
  offline browser automation.

## Work Split

### `aqa-runner` (new repo)

- `schema/ir.md` — authoritative IR v1 schema (op set, assert types, selector
  descriptor, sensitive handling, `ir_version` policy).
- `src/run.js` — deterministic interpreter (IR → Playwright), per-case
  isolation, secret injection + masking.
- `results.csv` + `report.html` emission, reusing the toolkit's schemas/templates.
- `.github/workflows/release.yml` — matrix build + Release upload.
- `run.bat` / `run.command` launchers.
- `README` — air-gap import procedure, how to obtain a bundle, how to supply
  `cases.compiled.yaml` and secrets.

### `claude-toolkit` (existing repo)

- Add to `aqa-inspect`: emit `cases.compiled.yaml` (IR v1) by recording a
  successful live run — capture, per step, the resolved `op`, `selector`,
  `value`/`value_ref`, and `assert`.
- Reference the `aqa-runner` IR schema as the compile target; stamp `ir_version`.

## Out of Scope

- `aqa-runner` does not generate, repair, or interpret natural-language cases.
- No LLM, no network calls at runtime.
- Carrying `results.csv` back out of the air-gap and filing Jira (`aqa-jira`) is
  a separate, local-side concern — unchanged by this work.

## Open Items (resolve during planning, not blocking)

- Exact `secrets.env` format and the `value_ref` → secret mapping convention.
- Whether `report.html` template is vendored into `aqa-runner` or shared via a
  copied file (no runtime dependency between repos either way).
- macOS launcher Gatekeeper quarantine note for first-run (`xattr` guidance in
  README).
