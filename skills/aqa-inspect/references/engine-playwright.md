# Engine Contract: Playwright (runtime DOM resolution)

This reference defines how the **Playwright** execution engine runs a
`cases.yaml` plan and populates `results.csv`. It is one of two interchangeable
engines for `aqa-inspect`; the other is documented in `engine-browser-use.md`.
Both engines consume the **same** `cases.yaml` (see `generate-figma.md` /
`generate-explore.md`) and emit the **same** `results.csv` schema (see
`results-csv.md`). The only difference is the runtime mechanism.

The defining property of this engine: **selectors are NOT pre-baked in
`cases.yaml`.** Each case carries only natural-language `steps`. This engine
resolves each step to a concrete Playwright locator **at runtime** by reading
the live page's accessibility snapshot and DOM. Runtime DOM resolution is the
whole point of this engine.

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

1. **Read the page** — call `page.accessibility.snapshot()` (and inspect the DOM
   where needed) to enumerate the current interactive surface.
2. **Resolve to a concrete locator** at runtime, preferring stable,
   human-meaningful queries in this order:
   - `page.getByRole(role, { name })`
   - `page.getByLabel(label)`
   - `page.getByText(text)`
   - a CSS selector as a last resort.
3. **Act** — `fill` / `click` / `goto` / etc. against the resolved locator.
   Apply `${key}` substitution from the case's `test_data` first, and mask any
   step marked `sensitive: true` as `****` in logs/output.
4. **Assert** — verify the expected post-condition (success state, error/
   validation message, navigation) from the snapshot / DOM.

No selector is read from `cases.yaml`; the locator is always derived from the
live DOM at the moment the step runs.

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

const input = JSON.parse(await readStdin());           // { case_id, name, test_data, steps, expected_result, headed }
const { case_id } = input;
const artifactsDir = `artifacts/${case_id}`;
mkdirSync(artifactsDir, { recursive: true });

const browser = await chromium.launch({ headless: !input.headed });
const context = await browser.newContext();            // isolated per case
const page = await context.newPage();

const result = { case_id, status: 'pass', finished_at: null,
                 failure_reason: '', expected_vs_actual: '',
                 evidence_path: '', discuss_note: '' };

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

try {
  for (const [i, step] of input.steps.entries()) {
    const tree = await page.accessibility.snapshot();  // runtime DOM/a11y read
    const locator = resolveLocator(page, step.action, tree);  // getByRole/getByText/getByLabel/CSS
    await act(page, locator, step, input.test_data);   // fill/click/goto, honor sensitive
    await assertStep(page, step);                      // verify post-condition
    const shot = `${artifactsDir}/step-${i + 1}.png`;
    await captureEvidence(page, locator, shot);        // red box on the verified element
    result.evidence_path = shot;
  }
  // reconcile against expected_result to set pass/fail/needs_discussion
} catch (err) {
  result.status = 'fail';
  result.failure_reason = String(err.message ?? err);
  // MULTI-LINE format (report renders pre-wrap): "기대: …\n실제: …"
  result.expected_vs_actual = describeExpectedVsActual(input, page);
} finally {
  result.finished_at = new Date().toISOString();
  await context.close();
  await browser.close();
}

process.stdout.write(JSON.stringify(result));
```

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

## Result Determination → `results.csv`

`results.csv` is the integration contract defined in `results-csv.md`. That file
is the single source of truth for column order, quoting (RFC 4180), and
empty-field rules. This engine MUST populate it exactly as described there, and
**identically to the browser-use engine** (`engine-browser-use.md`) — same
fields, same status semantics.

### Determining `status`

Determine the per-case outcome from the final page state / screenshots and the
case's `expected_result`:

- **`expected_result: "pass"`** → every step succeeded and the success state is
  observed ⇒ `status = pass`; any step failed or the success state is missing ⇒
  `status = fail`.
- **`expected_result: "fail"`** → the expected error/validation state appeared
  ⇒ `status = pass`; no error appeared (the action unexpectedly succeeded) ⇒
  `status = fail`.
- When pass/fail cannot be confidently determined ⇒ `status = needs_discussion`
  (see the rule below).

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
| `evidence_path` | Relative path under `artifacts/{case_id}/` to the captured screenshot/log. Set when `--screenshot` is on or on failure. |
| `discuss_note` | Free-text ambiguity note, set **only when `status = needs_discussion`** (see rule below). Empty otherwise. |
| `jira_key` | Always left **empty** by this engine; `aqa-jira` fills it later. |

## The `needs_discussion` Rule

Assign `needs_discussion` ONLY when pass/fail cannot be confidently determined from screenshots/state; always record a `discuss_note` explaining the ambiguity.

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
