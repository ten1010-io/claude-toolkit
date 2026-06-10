# Engine Contract: browser-use

This reference defines how the **browser-use** execution engine runs a
`cases.yaml` plan and populates `results.csv`. It is one of two interchangeable
engines for `aqa-inspect`; the other is documented in `engine-playwright.md`.
Both engines consume the **same** `cases.yaml` (schema in `cases-yaml.md`;
produced by `generate-figma.md` / `generate-explore.md`) and emit the **same**
`results.csv` schema (see `results-csv.md`). The only difference is the runtime
mechanism.

This engine drives an AI-interpreted browser session: each natural-language
`step.action` is interpreted at runtime against the live page state, with no
pre-baked selectors.

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

1. Read the current page via `{BROWSER_USE_CMD} --session case_{case_id} state`.
2. Interpret `action` and run the matching command:
   - **Navigation** → `open "{URL}"`
   - **Input** → `state` to locate the field index → `input {index} "{value}"`
   - **Click** → `state` to locate the control index → `click {index}`
   - **Verification** → inspect via `state`; fall back to
     `eval "document.body.innerText"` to confirm expected text / state.
3. Apply `${key}` substitution from the case's `test_data` before acting. Mask
   any step marked `sensitive: true` as `****` in logs/output.
4. If `--screenshot` is set, capture a screenshot for the step into
   `artifacts/{case_id}/` (this directory is also the source for
   `evidence_path`).
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
| `evidence_path` | Relative path under `artifacts/{case_id}/` to the captured screenshot/log. Set when `--screenshot` is on or on failure. |
| `discuss_note` | Free-text ambiguity note, set **only when `status = needs_discussion`** (see rule below). Empty otherwise. |
| `jira_key` | Always left **empty** by this engine; `aqa-jira` fills it later. |

## The `needs_discussion` Rule

Assign `needs_discussion` ONLY when pass/fail cannot be confidently determined from screenshots/state; always record a `discuss_note` explaining the ambiguity.
