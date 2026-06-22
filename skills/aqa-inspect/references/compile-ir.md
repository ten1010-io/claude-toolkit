# Compiling `cases.compiled.yaml` (IR v1)

This reference describes how an `aqa-inspect` execution turns a successful run
into a deterministic, LLM-free **IR** file — `cases.compiled.yaml` — that the
standalone
[`ten1010-io/aqa-runner`](https://github.com/ten1010-io/aqa-runner) executes
offline (no Claude, no network). **Both engines** (playwright and browser-use)
emit it.

> **Schema authority:** the IR contract is owned by `aqa-runner`
> (`schema/ir.md`). This file mirrors **IR v1**; keep them in sync. If they ever
> diverge, `aqa-runner/schema/ir.md` wins.

## When it runs

- **Both engines.** playwright and browser-use each return a `compiled_steps`
  array per case (see the engine refs), which the orchestrator assembles into
  the IR. browser-use selectors are AI-resolved and may be slightly less stable
  than playwright's live-DOM descriptors — the IR is still valid; a flaky
  offline replay can be re-recorded under the playwright engine.
- **Passing cases only.** Only cases that finished `status=pass` are compiled — a
  step that never executed cleanly has no trustworthy structured form. `fail`
  and `needs_discussion` cases are skipped.
- **One file per run**, written to the report dir next to `results.csv`:
  `reports/{ts}/cases.compiled.yaml`. It never replaces the natural-language
  `cases.yaml`.

## "Compile by recording"

Each engine already, per step, (a) resolves the locator (the selector cache),
(b) decides the operation it performs, and (c) verifies a post-condition.
Compilation is just **persisting those decisions** in structured form. Each
engine returns a `compiled_steps` array per case (see `engine-playwright.md` /
`engine-browser-use.md`); the orchestrator assembles those into the IR.

## IR v1 schema (mirror of `aqa-runner/schema/ir.md`)

```yaml
ir_version: 1            # required; the runner refuses any other value
name: "Login"            # copied from cases.yaml
description: "..."       # copied from cases.yaml (optional)
cases:
  - case_id: login-001   # copied verbatim (stable slug — rerun/Jira join key)
    name: "Log in with valid credentials"
    expected_result: pass     # copied verbatim from the source case (pass | fail)
    steps: [ ... ]            # the compiled_steps for this case, in order
    cleanup:                 # copied from the source case (optional)
      - type: clear_cookies
```

### Finite op set

`goto` · `fill` · `click` · `select` · `check` · `hover` · `press` · `assert`.
No `action` (natural-language) field may appear — its presence marks an
uncompiled file and the runner rejects it.

| op | fields | resolved from the source `action` |
|---|---|---|
| `goto` | `url` | "navigate to / open / go to URL" |
| `fill` | `selector`, (`value` \| `value_ref`) | "enter / type / fill X in field" |
| `click` | `selector` | "click / press the button/link" |
| `select` | `selector`, `value` | "select / choose V from dropdown" |
| `check` | `selector`, `checked?` (default `true`) | "check / uncheck / toggle" (`checked:false` = uncheck) |
| `hover` | `selector` | "hover over X" |
| `press` | `selector?`, `key` | "press Enter/Esc/Tab" (no selector ⇒ page-level key) |
| `assert` | `assert` | "verify / confirm / see / should …" |

### Finite assert types

Each `assert` step is `{ op: assert, assert: { type, … } }`.

| `assert.type` | extra fields | resolved from the source `action` |
|---|---|---|
| `visible` | `selector` | "X is visible / is shown / appears" |
| `hidden` | `selector` | "X is hidden / not visible / gone / removed" |
| `text_contains` | `selector`, `expected` | "X shows / contains text T" |
| `url_matches` | `expected` (substring or `/regex/`) | "URL is / contains / matches U" (no selector) |
| `enabled` | `selector` | "X is enabled / clickable" |
| `disabled` | `selector` | "X is disabled / greyed out" |
| `value_equals` | `selector`, `expected` | "field X equals / holds V" |
| `count` | `selector`, `expected` (int) | "there are N rows / items / results" |

### Selector descriptor

Reuse the **same** descriptor the selector cache already resolved (schema in
`cases-yaml.md`), `{ strategy: role|label|text|css, … }`, preference order
`role`+`name` > `label` > `text` > `css`. Omit `selector` for `goto`, a
page-level `press`, and `url_matches`.

## Variable & secret handling (CRITICAL)

- **Non-sensitive `${key}`** values: the live run used a concrete value, so emit
  it as the resolved literal `value` (e.g. `value: "testuser@example.com"`).
- **Sensitive steps** (`sensitive: true` on the source step — passwords, tokens,
  secrets): emit `value_ref: "<key>"` where `<key>` is the `test_data` key the
  source `action` referenced via `${key}` (e.g. a step filling `${password}`
  becomes `value_ref: "password"`). **Never** write the literal secret value into
  the IR, and never leave it as the resolved literal. At `aqa-runner` run time the
  key is resolved from `secrets.env` and masked as `****`.
- If a sensitive step's `${key}` cannot be identified, use the field's
  `test_data` key as `value_ref` — never fall back to the literal value.

The IR file must contain **no** secret values. This is the same masking
guarantee the rest of `aqa-inspect` enforces with `sensitive: true` / `****`.

## Assembly (who writes it)

The single-threaded orchestrator (never the parallel workers) is the only
writer — same rule as the selector cache. It collects each passing case's
`compiled_steps` and writes one `cases.compiled.yaml`. On `--rerun-failed` /
`--resume`, regenerate the file from the **union** of all currently-passing
cases in the report dir (previously-passing + newly-passing), keyed by
`case_id`, so the IR reflects every green case.

## Compact example

```yaml
ir_version: 1
name: "Login"
description: "User authentication flow"
cases:
  - case_id: login-001
    name: "Log in with valid credentials"
    expected_result: pass
    steps:
      - op: goto
        url: "https://app.example.com/login"
      - op: fill
        selector: { strategy: label, label: "Email" }
        value: "testuser@example.com"
      - op: fill
        selector: { strategy: label, label: "Password" }
        value_ref: "password"
        sensitive: true
      - op: click
        selector: { strategy: role, role: button, name: "Sign in" }
      - op: assert
        assert: { type: visible, selector: { strategy: text, text: "Dashboard" } }
    cleanup:
      - type: clear_cookies
```

Consumed by `ten1010-io/aqa-runner` — see its `README.md` for how a bundle runs
this file offline.
