# Engine Contract: Playwright (runtime DOM resolution)

This reference defines how the **Playwright** execution engine runs a
`cases.yaml` plan and populates `results.csv`. It is one of two interchangeable
engines for `aqa-inspect`; the other is documented in `engine-browser-use.md`.
Both engines consume the **same** `cases.yaml` (schema in `cases-yaml.md`;
produced by `generate-figma.md` / `generate-explore.md`) and emit the **same**
`results.csv` schema (see `results-csv.md`). The only difference is the runtime
mechanism.

The defining property of this engine: execution is **deterministic**. Each
step carries a machine `op` field (see "Machine op fields" in `cases-yaml.md`)
that the shipped driver interprets directly — no AI in the execution loop.
Generation (`generate-figma.md` / `generate-explore.md`) emits the `op`
annotations alongside the human-readable `action` sentences; anything
target-specific about authentication (login path, form selectors, button text)
lives in the plan's file-level `login:` block, never in the driver.

## Dependency Check

Verify Playwright is available before running:

```bash
npx playwright --version
```

- Expect **v1.60.0 or newer**.
- If it is missing (or older), print the install instructions below and **stop
  immediately**:

```
[ERROR] Playwright is not installed (or is older than v1.60.0).
Install it with:

  npm i -D playwright && npx playwright install chromium

Please try again after installation.
```

## Concrete Approach: the shipped driver (MANDATORY)

**Use the shipped deterministic driver — do NOT author a new driver per run,
and do NOT adapt the old stdin/stdout skeleton from memory.** Regenerating
driver logic per run is exactly how real IR bugs shipped: strict-unsafe text
selectors (a bare `getByText("CPU")` matches once per table row and fails
`aqa-runner`'s strict `expect()`), unsettled login redirects, and
`attr_equals` asserts the runner cannot execute. The shipped driver encodes
those lessons once.

Copy these three files from `references/` into the report dir and run from
there (they must sit together — `run-case.mjs` and `recompile-ir.mjs` both
import `compile.mjs`):

```bash
cp references/run-case.mjs references/compile.mjs references/recompile-ir.mjs reports/{ts}/
cd reports/{ts}/
npm ls playwright yaml || npm i playwright yaml   # driver deps, resolvable from the report dir
node run-case.mjs --cases ../../cases.yaml --tester {tester} --parallel {N} \
  [--headless] [--screenshot] [--only id1,id2]
```

What the driver does in one invocation:

- Executes every case (or only `--only` ids) through a worker pool of size
  `--parallel`, one isolated browser context per case.
- Logs in **once per account** (shared `storageState`), not once per case;
  cases that drive the login page itself (no `login` op) get a clean context.
- Interprets the machine `op` fields per `cases-yaml.md` ("Machine op fields");
  all login specifics come from the plan's `login:` block.
- Writes `results.csv` (RFC 4180, exactly per `results-csv.md`), failure-moment
  screenshots into `artifacts/{case_id}/`, `summary.json`, and
  `cases.compiled.yaml`.
- On a subset run (`--only`), merges results into the existing `results.csv`
  in place and rebuilds the IR from the **union** of all currently-passing
  cases (`compile-ir.md` union rule) — previously-passing cases are never
  dropped.

**Orchestrator responsibilities that remain with the skill (not the driver):**
creating the report dir, passing `--tester`, the `needs_discussion`
reclassification stage, re-running `recompile-ir.mjs` after any manual
`results.csv` edit (see below), and rendering `report.html` via `render.mjs`.

## Offline IR — compiled by `compile.mjs`, rebuilt by `recompile-ir.mjs`

`compile.mjs` is the **single source of truth** for the op → IR v2 mapping
(full IR rules in `compile-ir.md`). Because compilation is a pure function of
the case definition, the IR is always rebuilt from `cases.yaml` for every
`case_id` whose current `results.csv` status is `pass` — never appended to.

Encoded offline-replay guarantees (do not regress these when editing
`compile.mjs`):

- **Strict-safe text asserts.** `assert_text` compiles to `text_contains` on
  the unique `body` element. Never a bare text selector — `aqa-runner`'s
  `expect()` is strict and fails any locator matching 2+ elements.
- **Settled login redirects.** The `login` expansion ends with a `hidden`
  assert on the password field, so the offline replay waits out the post-login
  redirect instead of racing the session cookie. An `assert_url` targeting the
  login path is preceded by an auto-waiting `visible` assert on the login form
  (the runner's `url_matches` checks `page.url()` once, with no retry).
- **No `attr_equals`.** Attribute checks compile to a CSS attribute selector +
  `visible` (strict equality `[attr="v"]`; substring `[href*="v"]` for href).
- **Masking invariant.** A sensitive fill emits `value_ref` (the `test_data`
  key) — the IR must never contain a secret value.

After the `needs_discussion` reclassification stage (or any manual edit to
`results.csv`), rerun `node recompile-ir.mjs --cases ../../cases.yaml` in the
report dir so the IR matches the final pass set. It exits non-zero when the
compiled case count does not equal the `status=pass` row count — the
mandatory post-write check from `compile-ir.md`.

**Screenshot policy.** Default runs capture **nothing per step** — passing
cases pay zero screenshot overhead. Evidence is captured only at the **failure
moment**: when a step throws, or when a verification step's condition is not met
and the case lands on `fail` / `needs_discussion`, screenshot the page state right then into
`artifacts/{case_id}/` and set `evidence_path`. This failure-moment capture is
mandatory and independent of `--screenshot`. With `--screenshot` (full capture
mode), additionally capture every step for every case as shown in the loop.

**Evidence highlighting rule.** Whenever evidence is captured for a specific
element (the element a verification targeted, the missing-column header row,
the broken control), draw a temporary red outline (`3px solid #ef4444`,
`outline-offset: 2px`) on that element, scroll it into view, take the
screenshot, then restore the original style. Full-page context shots without a
single target element may skip the box.

CSS `outline` does not paint on some elements (observed: `<tr>` in
table-layout contexts). Fallback: inject a fixed-position overlay `<div>`
sized to the target's `getBoundingClientRect()` with
`border: 3px solid #ef4444; pointer-events: none; z-index: 99999`, screenshot,
then remove the overlay.

**`expected_vs_actual` formatting rule.** Always write it as two lines
separated by `\n` — `기대: <expected>` newline `실제: <observed>` (or
`Expected:` / `Actual:` in English runs). Never join them into one line with
`/` — the report renders this field with `white-space: pre-wrap`, and the CSV
quoting (RFC-4180) already handles embedded newlines.

**`failure_reason` formatting rule.** Same pre-wrap rendering: one finding per
line. When a failure has multiple checks or sub-findings, put each on its own
`\n`-separated line instead of a comma-joined parenthetical blob.

**Failure triage & enrichment (orchestrator, after the run).** The driver's
failure messages are mechanical (timeouts, mismatches) and written in English.
Before reporting, the orchestrator MUST review each failed case's evidence
screenshot and rewrite `failure_reason` / `expected_vs_actual` in the user's
language to name the **actual observed defect** — e.g. "the section header
renders in Korean ('기본 설정') instead of the expected English 'Basic
Settings'" beats "waitForFunction: Timeout 20000ms exceeded". A raw timeout is
a symptom, not a finding. Re-run suspected flakes (`--only <case_id>`) before
letting a transient failure stand, and update the row in place when the rerun
passes.

## Result Determination → `results.csv`

`results.csv` is the integration contract defined in `results-csv.md`. That file
is the single source of truth for column order, quoting (RFC 4180), and
empty-field rules. This engine MUST populate it exactly as described there, and
**identically to the browser-use engine** (`engine-browser-use.md`) — same
fields, same status semantics.

### Determining `status`

Determine the per-case outcome purely from whether the case's steps succeeded:

- **Every step — including the final verification/assert step — succeeded** ⇒
  `status = pass`.
- **Any step failed** — the engine could not perform the action, or a
  verification condition was not met ⇒ `status = fail`.
- When pass/fail cannot be confidently determined ⇒ `status = needs_discussion`
  (see the rule below).

Negative scenarios need no special handling — their final asserting step passes
exactly when the expected error/blocked state appears (see `cases-yaml.md`).

### How the driver fills the CSV fields

| Column | How this engine sets it |
|---|---|
| `case_id` | Copied from the executing case in `cases.yaml`. |
| `name` | Copied from the case `name`. |
| `status` | `pass` / `fail` / `needs_discussion` as determined above. |
| `tester` | **From the run, not the engine.** Passed via `--tester` (the run-start tester value); the driver never invents it. |
| `finished_at` | ISO-8601 timestamp when the case completed (`result.finished_at`). Leave empty if the case crashed/aborted before completing. |
| `failure_reason` | Free-text reason, set **only when `status = fail`**. Empty otherwise. |
| `expected_vs_actual` | Expected vs observed, set when `status = fail` **or** `needs_discussion`. Empty when `pass`. |
| `evidence_path` | Relative path under `artifacts/{case_id}/` to the captured screenshot/log. **Always set for `fail` / `needs_discussion`** (failure-moment capture is mandatory). Set for `pass` only in `--screenshot` full-capture mode. |
| `discuss_note` | Free-text ambiguity note, set **only when `status = needs_discussion`** (see rule below). Empty otherwise. |
| `jira_key` | Always left **empty** by this engine; `aqa-jira` fills it later. |

## The `needs_discussion` Rule

Assign `needs_discussion` ONLY when pass/fail cannot be confidently determined from screenshots/state; always record a `discuss_note` explaining the ambiguity.

This is a **last resort**, per the Automation-first mandate in `SKILL.md`: before
marking a case manual, attempt to verify it from the live DOM (text, element
state, attributes, computed styles, URL, download events). The `discuss_note`
must name a specific blocker (DB/account state, missing role credentials, real
persistent mutation, un-inducible data state, external pixel comparison,
non-deterministic timing) — a generic "visual check needed" is a classification
bug.

## `--headed` / `--headless` and `--parallel N`

- **`--headed` / `--headless`** — passed through to the Chromium launch:
  `chromium.launch({ headless: !headed })`. Default is headed unless
  `--headless` is given.
- **`--parallel N`** — run up to `N` cases concurrently. Each concurrent case
  gets its **own browser context** (`browser.newContext()`) so cookies, storage,
  and tabs stay isolated between cases — equivalent to the per-case
  `--session case_{case_id}` isolation in the browser-use engine. The driver
  runs an in-process worker pool of size `N` over one shared Chromium instance;
  `--parallel 1` runs cases sequentially.
