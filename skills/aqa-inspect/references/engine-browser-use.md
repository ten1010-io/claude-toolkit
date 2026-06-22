# Engine Contract: browser-use

This reference defines how the **browser-use** execution engine runs a
`cases.yaml` plan and populates `results.csv`. It is one of two interchangeable
engines for `aqa-inspect`; the other is documented in `engine-playwright.md`.
Both engines consume the **same** `cases.yaml` (schema in `cases-yaml.md`;
produced by `generate-figma.md` / `generate-explore.md`) and emit the **same**
`results.csv` schema (see `results-csv.md`). The only difference is the runtime
mechanism.

This engine drives an AI-interpreted browser session: each natural-language
`step.action` is interpreted at runtime when no cached descriptor is present; a
machine-learned `selector` descriptor, when present, is resolved to an element
index directly (see Selector write-back).

## Dependency Check + `BROWSER_USE_CMD`

Before running anything, verify that the `browser-use` CLI is available.

### Search order

Probe for the CLI in this order:

1. **Global install**: run `browser-use --help`
2. **Project venv**: run `.browser-use/bin/browser-use --help` (relative to
   project root)
3. **Home directory venv**: run `~/.browser-use/bin/browser-use --help`

- On the first success → store that path as `BROWSER_USE_CMD` and use it for
  **every** subsequent `browser-use` invocation:
  - Global install: `browser-use open "..."`
  - venv install: `.browser-use/bin/browser-use open "..."` or
    `~/.browser-use/bin/browser-use open "..."`
- If all probes fail → print the message below and **stop immediately**:

```
[ERROR] browser-use CLI is not installed.
Please install it using one of the methods below (uv venv recommended):

  # Per-project install (current directory)
  uv venv .browser-use --python 3.12
  uv pip install browser-use --python .browser-use/bin/python

  # Or global install (home directory)
  uv venv ~/.browser-use --python 3.12
  uv pip install browser-use --python ~/.browser-use/bin/python

Please try again after installation.
```

> uv venv + Python 3.12 is recommended to avoid Python 3.14 compatibility
> issues.

## Per-Case Execution

Each case runs in its own isolated browser session. The per-step execution loop
below (open → handle SSL warnings → execute steps → cleanup) is applied per
`case_id`.

### Open the session

```bash
{BROWSER_USE_CMD} --session case_{case_id} --headed open "{BASE_URL}"
```

- Use `--session case_{case_id}` so each case is isolated (cookies, storage,
  tabs). `case_id` comes from `cases.yaml`.
- Honor `--headed` / `--headless` from the run invocation (default headed).

### Handle SSL certificate warnings

If `browser-use state` output contains `"Your connection is not private"` or
`"ERR_CERT"`: click **Advanced** → **Proceed to (unsafe)**, then continue.

### Execute each step

For each entry in the case's `steps` (interpret the natural-language `action` at
runtime):

0. **Cached descriptor present** (`step.selector`) — resolve it to an element
   index without an AI `state` interpretation: build a CSS query from the
   descriptor (`strategy: css` → its `css`; `role`/`label`/`text` → an
   equivalent attribute/text query) and run
   `{BROWSER_USE_CMD} --session case_{case_id} eval "<querySelector expr that
   returns the element's browser-use index>"`. If it returns one element AND
   (`selector_anchor` absent OR the element text contains the substituted
   anchor) ⇒ use that index, skipping step 1's `state` read.
1. Read the current page via `{BROWSER_USE_CMD} --session case_{case_id} state`
   — **only** when there is no usable cached descriptor (absent, miss, or anchor
   mismatch). Resolve from `action`, then record the descriptor for write-back.
2. Interpret `action` and run the matching command:
   - **Navigation** → `open "{URL}"`
   - **Input** → `state` to locate the field index → `input {index} "{value}"`
   - **Click** → `state` to locate the control index → `click {index}`
   - **Verification** → inspect via `state`; fall back to
     `eval "document.body.innerText"` to confirm expected text / state.
3. Apply `${key}` substitution from the case's `test_data` before acting. Mask
   any step marked `sensitive: true` as `****` in logs/output.
4. Screenshot policy:
   - **`--screenshot` (full capture mode)** → capture a screenshot for every
     step into `artifacts/{case_id}/`.
   - **Default (flag off)** → no per-step captures. But the moment a step
     fails — or the case is determined `fail` / `needs_discussion` — capture
     the page state at that moment into `artifacts/{case_id}/` and use it as
     `evidence_path`. **Failure-moment evidence is mandatory in both modes;
     never finish a `fail` / `needs_discussion` case without a screenshot.**
5. **Evidence highlighting**: when the evidence targets a specific element
   (the verified control, a missing column's header row, a broken field),
   draw a temporary red outline on it before capturing — via
   `eval "el.style.outline='3px solid #ef4444'; el.style.outlineOffset='2px'; el.scrollIntoView({block:'center'})"`
   on the located element — take the screenshot, then restore the style.
   Full-page context shots without a single target may skip the box.
6. **`expected_vs_actual` formatting**: always two lines separated by `\n` —
   `기대: <expected>` newline `실제: <observed>` (or `Expected:`/`Actual:`).
   Never a single `/`-joined line; the report renders this field pre-wrap and
   RFC-4180 CSV quoting handles embedded newlines.
7. **`failure_reason` formatting**: same pre-wrap rendering — one finding per
   line (`\n`-separated), never a comma-joined parenthetical blob.

### Cleanup

After the case finishes (pass, fail, or needs_discussion), always clean up the
session:

```bash
{BROWSER_USE_CMD} --session case_{case_id} cookies clear
{BROWSER_USE_CMD} --session case_{case_id} close
```

## Selector write-back (per-case result)

For each step resolved at runtime (cache miss / anchor mismatch / first fill),
report the resolved descriptor so the orchestrator can persist it into
`cases.yaml`. Per case, return:

```json
"resolved_selectors": [
  { "step": 3,
    "selector": { "strategy": "role", "role": "button", "name": "Sign in" },
    "anchor": "Sign in",
    "changed": true,
    "old": { "strategy": "role", "role": "button", "name": "Log in" } }
]
```

Field semantics are identical to the Playwright engine: `step` is 0-based;
`changed: true` only when an existing descriptor was overwritten (drift), else
`false` with `old: null`. The descriptor schema (`strategy` ∈
`role | label | text | css`) is defined in `cases-yaml.md`.

- **`sensitive` steps:** never capture a secret value into `selector` or
  `anchor` — record only field identifiers (e.g. `{strategy: role, role:
  textbox, name: Password}`), never the typed value.

The engine never writes `cases.yaml`; the orchestrator is the single writer
(see `SKILL.md`).

## Compiled-step capture (per-case result) — for the offline IR

Like the Playwright engine, browser-use also returns, for **every step it runs**,
the structured IR form it executed, in step order, as a `compiled_steps` array.
The orchestrator assembles these into `reports/{ts}/cases.compiled.yaml` (IR v1)
for [`aqa-runner`](https://github.com/ten1010-io/aqa-runner). Full rules and the
op/assert mapping: `references/compile-ir.md`.

Each entry is a ready-to-serialize IR step:

- the resolved `op` — `goto` / `fill` / `click` / `select` / `check` / `hover` /
  `press`, or `assert` for a verification step;
- the resolved `selector` descriptor (the **same** one captured for the selector
  cache above) — omitted for `goto`, a page-level `press`, and `url_matches`;
- `value` for a non-sensitive fill/select, OR `value_ref: "<test_data key>"` +
  `sensitive: true` for a sensitive step — **never the secret value**;
- for a verification step, the `assert: { type, … }` object per `compile-ir.md`.

```json
"compiled_steps": [
  { "op": "goto", "url": "https://app.example.com/login" },
  { "op": "fill", "selector": {"strategy":"label","label":"Email"}, "value": "testuser@example.com" },
  { "op": "fill", "selector": {"strategy":"label","label":"Password"}, "value_ref": "password", "sensitive": true },
  { "op": "click", "selector": {"strategy":"role","role":"button","name":"Sign in"} },
  { "op": "assert", "assert": {"type":"visible","selector":{"strategy":"text","text":"Dashboard"}} }
]
```

- Populate `compiled_steps` only when the case **passes**; the orchestrator
  discards any partial array from a failed case.
- **Masking invariant:** never put a secret value into `compiled_steps` — a
  sensitive step carries `value_ref` only.
- **Selector quality note:** browser-use resolves selectors via AI
  interpretation, so a descriptor may occasionally be less stable than the
  Playwright (live-DOM) engine's. The emitted IR is still valid; if an offline
  `aqa-runner` replay misses an element, re-running that case under the
  Playwright engine produces a sturdier descriptor.

## Result Determination → `results.csv`

`results.csv` is the integration contract defined in `results-csv.md`. That file
is the single source of truth for column order, quoting (RFC 4180), and
empty-field rules. This engine MUST populate it exactly as described there.

### Determining `status`

Determine the per-case outcome from the final page state / screenshots and the
case's `expected_result` (semantics defined in `cases-yaml.md`):

- **`expected_result: "pass"`** → every step succeeded and the success state is
  observed ⇒ `status = pass`; any step failed or the success state is missing ⇒
  `status = fail`.
- **`expected_result: "fail"`** → the expected error/validation state appeared
  ⇒ `status = pass`; no error appeared (the action unexpectedly succeeded) ⇒
  `status = fail`.
- When pass/fail cannot be confidently determined ⇒ `status = needs_discussion`
  (see the rule below).

### Populating each field

| Column | How this engine sets it |
|---|---|
| `case_id` | Copied from the executing case in `cases.yaml`. |
| `name` | Copied from the case `name`. |
| `status` | `pass` / `fail` / `needs_discussion` as determined above. |
| `tester` | **From the run, not the engine.** The engine leaves this to be filled by the run-start tester value; it never invents it. |
| `finished_at` | ISO-8601 timestamp when the case completed. Leave empty if the case crashed/aborted before completing. |
| `failure_reason` | Free-text reason, set **only when `status = fail`**. Empty otherwise. |
| `expected_vs_actual` | Expected vs observed, set when `status = fail` **or** `needs_discussion`. Empty when `pass`. |
| `evidence_path` | Relative path under `artifacts/{case_id}/` to the captured screenshot/log. **Always set for `fail` / `needs_discussion`** (failure-moment capture is mandatory). Set for `pass` only in `--screenshot` full-capture mode. |
| `discuss_note` | Free-text ambiguity note, set **only when `status = needs_discussion`** (see rule below). Empty otherwise. |
| `jira_key` | Always left **empty** by this engine; `aqa-jira` fills it later. |

## The `needs_discussion` Rule

Assign `needs_discussion` ONLY when pass/fail cannot be confidently determined from screenshots/state; always record a `discuss_note` explaining the ambiguity.
