# Engine Contract: Playwright (runtime DOM resolution)

This reference defines how the **Playwright** execution engine runs a
`cases.yaml` plan and populates `results.csv`. It is one of two interchangeable
engines for `aqa-inspect`; the other is documented in `engine-browser-use.md`.
Both engines consume the **same** `cases.yaml` (schema in `cases-yaml.md`;
produced by `generate-figma.md` / `generate-explore.md`) and emit the **same**
`results.csv` schema (see `results-csv.md`). The only difference is the runtime
mechanism.

The defining property of this engine: each case carries natural-language
`steps`, and each step **may optionally** carry a cached `selector` descriptor
(schema in `cases-yaml.md`). This engine tries the cached descriptor first and
falls back to resolving the step to a concrete Playwright locator **at runtime**
by reading the live page's accessibility snapshot and DOM whenever no cached
descriptor is present, the cached locator misses, or its anchor no longer
matches. Runtime DOM resolution remains the reliable fallback that keeps a case
runnable even when the cache is empty or stale.

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

## Execution Model

Drive a Chromium page directly. For each natural-language `step.action`:

1. **Cached descriptor present** — map `step.selector` to a locator:
   - `strategy: role` → `page.getByRole(role, { name })`
   - `strategy: label` → `page.getByLabel(label)`
   - `strategy: text` → `page.getByText(text)`
   - `strategy: css` → `page.locator(css)`
   Apply `${key}` substitution to descriptor values first. If the locator
   resolves to exactly one element AND (`selector_anchor` is absent OR the
   element's visible text contains the substituted anchor) ⇒ use it.
2. **No descriptor, locator misses, or anchor mismatch** — read the page
   (`page.accessibility.snapshot()` / DOM) and resolve from `step.action` at
   runtime, preferring `getByRole` > `getByLabel` > `getByText` > CSS. Record
   the resolved descriptor for write-back (see "Selector write-back").
3. **Act** — `fill` / `click` / `goto` against the resolved locator; apply
   `${key}` substitution; mask any `sensitive: true` step as `****`.
4. **Assert** — verify the expected post-condition. The cache never bypasses
   this assertion; a wrong-element match still fails here.

When no cached descriptor is present (or it no longer matches), the locator is
derived from the live DOM at the moment the step runs — the cache is a fast path
over runtime resolution, never a replacement for the step assertion.

## Concrete Approach: per-run `run-case.mjs` driver

The skill writes a small per-run Node driver, `run-case.mjs`, that executes a
single case. It reads one case as JSON on **stdin** and returns a JSON result on
**stdout**, capturing screenshots into `artifacts/{case_id}/`. The orchestrator
(the skill) pipes each case in and parses each result out, then maps the result
into `results.csv`.

Illustrative skeleton (not exhaustive — error handling, per-step locator
resolution, and assertion logic are elided):

```javascript
// run-case.mjs — reads one case JSON on stdin, emits one result JSON on stdout
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const input = JSON.parse(await readStdin());           // { case_id, name, test_data, steps, headed, screenshot }
const { case_id } = input;
const artifactsDir = `artifacts/${case_id}`;
mkdirSync(artifactsDir, { recursive: true });

const browser = await chromium.launch({ headless: !input.headed });
const context = await browser.newContext();            // isolated per case
const page = await context.newPage();

const result = { case_id, status: 'pass', finished_at: null,
                 failure_reason: '', expected_vs_actual: '',
                 evidence_path: '', discuss_note: '',
                 resolved_selectors: [],   // descriptors resolved at runtime, for write-back
                 compiled_steps: [] };      // structured IR steps (passing cases) → cases.compiled.yaml

// Highlight the element under test with a red box before capturing evidence,
// so the report reader instantly sees WHERE to look. Remove the box afterward.
async function captureEvidence(page, locator, path) {
  let handle = null;
  if (locator) {
    handle = await locator.elementHandle().catch(() => null);
    if (handle) await handle.evaluate(el => {
      el.__aqaPrev = el.style.outline;
      el.style.outline = '3px solid #ef4444';
      el.style.outlineOffset = '2px';
      el.scrollIntoView({ block: 'center' });
    });
  }
  await page.screenshot({ path });
  if (handle) await handle.evaluate(el => { el.style.outline = el.__aqaPrev ?? ''; });
}

let lastLocator = null;
try {
  for (const [i, step] of input.steps.entries()) {
    const tree = await page.accessibility.snapshot();  // runtime DOM/a11y read
    const locator = resolveLocator(page, step, tree);  // try step.selector cache first, else resolve from step.action
    // on a runtime resolution (cache miss / anchor mismatch / first fill),
    // push the resolved descriptor onto result.resolved_selectors (step = i, changed/old per drift)
    lastLocator = locator;
    await act(page, locator, step, input.test_data);   // fill/click/goto, honor sensitive
    await assertStep(page, step);                      // verify post-condition
    if (input.screenshot) {                            // full capture mode only
      const shot = `${artifactsDir}/step-${i + 1}.png`;
      await captureEvidence(page, locator, shot);      // red box on the verified element
      result.evidence_path = shot;
    }
  }
  // status is pass when every step — including the final verification/assert
  // step — passed; if any step failed (or the outcome is ambiguous), set
  // fail/needs_discussion and capture failure evidence as below
} catch (err) {
  result.status = 'fail';
  result.failure_reason = String(err.message ?? err);
  // MULTI-LINE format (report renders pre-wrap): "기대: …\n실제: …"
  result.expected_vs_actual = describeExpectedVsActual(input, page);
  // Failure-moment evidence — ALWAYS captured, even without --screenshot
  const shot = `${artifactsDir}/failure.png`;
  await captureEvidence(page, lastLocator, shot).catch(() => {});
  result.evidence_path = shot;
} finally {
  result.finished_at = new Date().toISOString();
  await context.close();
  await browser.close();
}

process.stdout.write(JSON.stringify(result));
```

## Selector write-back (result JSON)

`run-case.mjs` returns the resolved descriptor for each step that it resolved at
runtime (cache miss / anchor mismatch / first fill), so the orchestrator can
persist them into `cases.yaml`. Add a `resolved_selectors` array to the result
JSON:

```json
"resolved_selectors": [
  { "step": 3,
    "selector": { "strategy": "role", "role": "button", "name": "Sign in" },
    "anchor": "Sign in",
    "changed": true,
    "old": { "strategy": "role", "role": "button", "name": "Log in" } }
]
```

- `step` — 0-based index into the case's `steps`.
- `selector` — the descriptor the engine resolved at runtime.
- `anchor` — the visible text captured as `selector_anchor` (may be empty).
- `changed` — `true` only when an **existing** descriptor was overwritten
  (a stale cache re-resolved differently → drift). First-time fill of an empty
  `selector` is `changed: false`, `old: null`.
- `old` — the previous descriptor when `changed: true`, else `null`.
- **`sensitive` steps:** never capture a secret value into `selector` or
  `anchor` — record only field identifiers (e.g. `{strategy: role, role:
  textbox, name: Password}`), never the typed value.

The engine MUST NOT write `cases.yaml` itself; it only returns this array. The
orchestrator is the single writer (see `SKILL.md`).

## Compiled-step capture (result JSON) — for the offline IR

In addition to `resolved_selectors`, the driver records, for **every step it
runs**, the structured IR form it actually executed, and returns them in step
order as a `compiled_steps` array. This is the raw material the orchestrator
assembles into `reports/{ts}/cases.compiled.yaml` (IR v2) for
[`aqa-runner`](https://github.com/ten1010-io/aqa-runner). Full IR rules and the
op/assert mapping live in `references/compile-ir.md`.

Each entry is a ready-to-serialize IR step:

- the resolved `op` — whichever of `goto` / `fill` / `click` / `select` /
  `check` / `hover` / `press` it performed, or `assert` for a verification step;
- the resolved `selector` descriptor (the **same** one captured for the selector
  cache) — omitted for `goto`, a page-level `press`, and `url_matches`;
- `value` for a non-sensitive fill/select (the concrete value used), OR
  `value_ref: "<test_data key>"` + `sensitive: true` for a sensitive step;
- for a verification step, the `assert: { type, … }` object per
  `compile-ir.md`'s assert-type table.

```json
"compiled_steps": [
  { "op": "goto", "url": "https://app.example.com/login" },
  { "op": "fill", "selector": {"strategy":"label","label":"Email"}, "value": "testuser@example.com" },
  { "op": "fill", "selector": {"strategy":"label","label":"Password"}, "value_ref": "password", "sensitive": true },
  { "op": "click", "selector": {"strategy":"role","role":"button","name":"Sign in"} },
  { "op": "assert", "assert": {"type":"visible","selector":{"strategy":"text","text":"Dashboard"}} }
]
```

- Populate `compiled_steps` only when the case **passes**. On failure the driver
  may return a partial array; the orchestrator discards it (only passing cases
  compile).
- **Masking invariant:** `compiled_steps` MUST never contain a secret value — a
  sensitive step carries `value_ref` only, never the typed value, consistent
  with the `sensitive: true` / `****` rule used everywhere else.
- This array, like `resolved_selectors`, is returned by the worker; the
  orchestrator is the single writer of `cases.compiled.yaml`.

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

### Mapping the `run-case.mjs` JSON result → CSV fields

| Column | How this engine sets it |
|---|---|
| `case_id` | Copied from the executing case in `cases.yaml`. |
| `name` | Copied from the case `name`. |
| `status` | `pass` / `fail` / `needs_discussion` as determined above. |
| `tester` | **From the run, not the engine.** The engine leaves this to be filled by the run-start tester value; it never invents it. |
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
  `--session case_{case_id}` isolation in the browser-use engine. Run the cases
  through a worker pool of size `N`: launch up to `N` `run-case.mjs` processes,
  and as each one finishes, start the next pending case until all are done.
  `--parallel 1` runs cases sequentially.
