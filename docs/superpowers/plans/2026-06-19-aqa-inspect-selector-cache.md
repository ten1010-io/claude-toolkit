# AQA Inspect Selector Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> When editing the skill files, also consult `superpowers:writing-skills` for skill structure/frontmatter conventions.

**Goal:** Add a machine-learned, engine-neutral selector cache to `aqa-inspect` so the second and later executions (rerun/resume) of both engines skip natural-language locator resolution and run fast.

**Architecture:** The cache is an **optional** structured `selector` descriptor embedded per step in `cases.yaml` (which already survives rerun/resume in the report dir). Generation harvests descriptors where it touches live DOM; execution fills blanks on run 1, prefers the cached descriptor on later runs, and self-heals + records drift when a cached descriptor goes stale. Both engines map the same neutral descriptor to their own locate mechanism. `results.csv` and `summary.json` are untouched; drift surfaces only in a new `selector-drift.json` sidecar and the HTML report.

**Tech Stack:** Markdown skill docs; YAML (`cases.yaml`); Node Playwright (`run-case.mjs`); browser-use CLI; JSON sidecars; HTML report template.

**Verification model:** These are documentation skills, not unit-testable code. "Tests" per task = (a) any YAML frontmatter still parses, (b) every `references/...` path mentioned in a doc exists, (c) the new descriptor schema is described **identically** wherever it appears (cross-doc grep), (d) `results-csv.md` and its `aqa-jira` copy are **unchanged**, and (e) a final manual smoke read-through. Reference existing files instead of reproducing them.

**Source of truth:** [docs/superpowers/specs/2026-06-19-aqa-inspect-selector-cache-design.md](../specs/2026-06-19-aqa-inspect-selector-cache-design.md)

## Global Constraints

- Plugin version bumps `0.3.2` → `0.3.3` in **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (Task 7).
- `results-csv.md` and `skills/aqa-jira/references/csv-contract.md` MUST stay byte-identical and **unchanged** by this work. `summary.json` shape is also unchanged.
- The `selector` / `selector_anchor` step fields are **always optional**; a step without them behaves exactly as today (full backward compatibility).
- `selector` and `selector_anchor` are **machine-managed** (generation harvest + execution write-back), never required from a human author.
- Never place a `sensitive` value into `selector` or `selector_anchor` — field identifiers only.
- Commit messages in English (no attribution trailer — disabled globally).

---

## Canonical shapes (referenced by every task)

**`cases.yaml` step descriptor** (defined in Task 1, consumed by Tasks 2-6):

```yaml
steps:
  - action: "Click the Sign in button"
    selector:                  # optional
      strategy: role           # one of: role | label | text | css
      role: button             # present when strategy=role
      name: "Sign in"          # present when strategy=role
      label: "Email"           # present when strategy=label
      text: "Sign in"          # present when strategy=text
      css: "button.primary"    # present when strategy=css (last resort)
    selector_anchor: "Sign in" # optional expected visible text
```

Learning preference order: `role`+`name` > `label` > `text` > `css`.

**Engine result-JSON write-back field** (produced by Tasks 2 & 3, consumed by Task 5):

```json
"resolved_selectors": [
  {
    "step": 3,
    "selector": { "strategy": "role", "role": "button", "name": "Sign in" },
    "anchor": "Sign in",
    "changed": true,
    "old": { "strategy": "role", "role": "button", "name": "Log in" }
  }
]
```

- `step` is the **0-based** index into the case's `steps`.
- `changed: true` only when re-resolution **overwrote an existing** descriptor (drift). First-time fill of an empty `selector` is `changed: false`, `old: null`.

**`selector-drift.json` sidecar** (produced by Task 5, consumed by Task 6):

```json
[
  { "case_id": "login-001", "step": 3,
    "old": { "strategy": "role", "role": "button", "name": "Log in" },
    "new": { "strategy": "role", "role": "button", "name": "Sign in" } }
]
```

---

## File Structure

Modified files (no new skill files):

```
skills/aqa-inspect/references/cases-yaml.md        # T1: descriptor schema
skills/aqa-inspect/references/engine-playwright.md # T2: selector-first + write-back + drift
skills/aqa-inspect/references/engine-browser-use.md# T3: querySelector→index + write-back + drift
skills/aqa-inspect/references/generate-explore.md  # T4: harvest descriptors
skills/aqa-inspect/references/generate-figma.md    # T4: note selector left empty
skills/aqa-inspect/SKILL.md                        # T5: cache behavior, sidecar output, single-writer
skills/aqa-inspect/references/report-template.html # T6: drift badge + IF block
.claude-plugin/plugin.json                         # T7: version bump
.claude-plugin/marketplace.json                    # T7: version bump
```

Unchanged on purpose: `skills/aqa-inspect/references/results-csv.md`, `skills/aqa-jira/**`, `commands/aqa-inspect.md` (no new CLI flags — cache is automatic).

---

## Task 1: Descriptor schema in `cases-yaml.md`

**Files:**
- Modify: `skills/aqa-inspect/references/cases-yaml.md`

**Interfaces:**
- Produces: the `selector` / `selector_anchor` per-step schema (canonical shape above) that Tasks 2-6 reference.

- [ ] **Step 1: Add the two optional fields to the "Per step" table**

In the "Per step" table (currently `action`, `sensitive`), add two rows after `sensitive`:

```markdown
| `selector` | optional | **Machine-managed** structured locator cache for this step (not human-authored). Engine-neutral descriptor with a `strategy` discriminator (`role`/`label`/`text`/`css`) and the matching keys. Populated by generation harvest and/or first-run execution; reused on rerun/resume. Absent ⇒ the engine resolves the step from `action` at runtime, as before. |
| `selector_anchor` | optional | Expected visible text on the targeted element, used as a heal trigger and false-positive guard when a cached `selector` is reused. Never contains a `sensitive` value. |
```

- [ ] **Step 2: Add a "Selector Cache (machine-managed)" subsection**

After the "Variable Substitution Rules" section, add:

````markdown
## Selector Cache (machine-managed)

`selector` is an **optional, machine-managed** cache — never required from a
human author. It lets the execution engines skip natural-language locator
resolution on reruns. The contract is *no human-authored selectors*; a learned
cache is a different thing and is allowed here.

### Descriptor shape

```yaml
selector:
  strategy: role        # one of: role | label | text | css
  role: button          # strategy=role  → role + name
  name: "Sign in"
  # label: "Email"      # strategy=label
  # text: "Sign in"     # strategy=text
  # css: "button.primary"  # strategy=css (last resort, low confidence)
selector_anchor: "Sign in"   # optional expected visible text
```

Learning preference order (most to least stable): `role`+`name` > `label` >
`text` > `css`.

### Rules

- **Optional + backward compatible.** A step with no `selector` behaves exactly
  as a step did before this field existed.
- **`${var}` substitution applies** to `selector` values (e.g. a `name`
  containing `${orderId}`) identically to `action` — store the placeholder
  verbatim and substitute at execution time.
- **`sensitive` values never appear** in `selector` or `selector_anchor`; store
  only field identifiers (a password field is `{strategy: role, role: textbox,
  name: Password}`).
- **Who fills it:** generation harvest (live-DOM paths) and/or first-run
  execution write-back. A fresh regeneration produces a new `cases.yaml` and
  re-harvests — stale selectors are not inherited.
````

- [ ] **Step 3: Add a compact example with a selector**

In the "Compact Example", add `selector` to one step of `login-001` (the Sign in click) to show the shape inline:

```yaml
      - action: "Click the Sign in button and wait for page load"
        selector:
          strategy: role
          role: button
          name: "Sign in"
        selector_anchor: "Sign in"
```

- [ ] **Step 4: Verify the doc is internally consistent**

Run:
```bash
grep -n "strategy\|selector_anchor\|role | label | text | css\|role`+`name" skills/aqa-inspect/references/cases-yaml.md
```
Expected: the `strategy` enum (`role | label | text | css`), `selector_anchor`, and the preference order all appear; the example step shows `strategy: role`.

- [ ] **Step 5: Confirm `results-csv.md` was not touched**

Run:
```bash
git status --porcelain skills/aqa-inspect/references/results-csv.md
```
Expected: empty output (no modification).

- [ ] **Step 6: Commit**

```bash
git add skills/aqa-inspect/references/cases-yaml.md
git commit -m "feat(aqa-inspect): add optional machine-managed selector cache schema to cases.yaml"
```

---

## Task 2: Playwright engine — selector-first resolution, write-back, drift

**Files:**
- Modify: `skills/aqa-inspect/references/engine-playwright.md`

**Interfaces:**
- Consumes: descriptor schema from Task 1.
- Produces: the `resolved_selectors` field in the `run-case.mjs` result JSON (canonical shape above), consumed by Task 5.

- [ ] **Step 1: Revise the "Execution Model" to be selector-first**

Replace the numbered "Execution Model" list so step resolution checks the cache first. New list:

```markdown
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
```

- [ ] **Step 2: Add a "Selector write-back" subsection**

After the "Concrete Approach" code skeleton, add:

````markdown
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

The engine MUST NOT write `cases.yaml` itself; it only returns this array. The
orchestrator is the single writer (see `SKILL.md`).
````

- [ ] **Step 3: Note the descriptor in the result-JSON skeleton comment**

In the `run-case.mjs` skeleton, update the `const result = {...}` initializer comment / object to include `resolved_selectors: []`, and add a one-line comment at the per-step loop noting "push the resolved descriptor onto result.resolved_selectors on a runtime resolution".

- [ ] **Step 4: Verify selector-first wording is present**

Run:
```bash
grep -n "Cached descriptor present\|resolved_selectors\|never bypasses\|getByRole(role, { name })" skills/aqa-inspect/references/engine-playwright.md
```
Expected: all four phrases present.

- [ ] **Step 5: Verify the "always runtime" claim was removed/softened**

Run:
```bash
grep -n "always derived from the live DOM\|No selector is read from" skills/aqa-inspect/references/engine-playwright.md
```
Expected: the old absolute statements are gone or rephrased to "when no cached descriptor is present". If they still assert unconditional runtime resolution, fix them.

- [ ] **Step 6: Commit**

```bash
git add skills/aqa-inspect/references/engine-playwright.md
git commit -m "feat(aqa-inspect): Playwright engine reuses cached selectors with write-back and drift"
```

---

## Task 3: browser-use engine — querySelector→index, write-back, drift

**Files:**
- Modify: `skills/aqa-inspect/references/engine-browser-use.md`

**Interfaces:**
- Consumes: descriptor schema from Task 1.
- Produces: the same `resolved_selectors` per-case result shape (canonical shape above), consumed by Task 5.

- [ ] **Step 1: Insert a cache-first branch into "Execute each step"**

In the "Execute each step" numbered list, before the current step 1 (`state`),
add a cache branch and reword step 2:

```markdown
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
```

Renumber the remaining items (interpret/act, substitution, screenshot, etc.)
accordingly.

- [ ] **Step 2: Add a "Selector write-back" subsection (mirrors Playwright)**

After "Per-Case Execution", add a subsection identical in contract to the
Playwright one — the engine returns a per-case `resolved_selectors` array with
`step` / `selector` / `anchor` / `changed` / `old`, never writes `cases.yaml`
itself, and the orchestrator persists it:

````markdown
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
`false` with `old: null`. The engine never writes `cases.yaml`; the
orchestrator is the single writer.
````

- [ ] **Step 3: Soften the "no pre-baked selectors" line**

The header paragraph says "interpreted at runtime ... with no pre-baked
selectors." Reword to: "interpreted at runtime when no cached descriptor is
present; a machine-learned `selector` descriptor, when present, is resolved to an
element index directly (see Selector write-back)."

- [ ] **Step 4: Verify**

Run:
```bash
grep -n "Cached descriptor present\|resolved_selectors\|querySelector\|when no cached descriptor is present" skills/aqa-inspect/references/engine-browser-use.md
```
Expected: all four phrases present.

- [ ] **Step 5: Commit**

```bash
git add skills/aqa-inspect/references/engine-browser-use.md
git commit -m "feat(aqa-inspect): browser-use engine resolves cached selectors to index with write-back"
```

---

## Task 4: Generation harvest (`generate-explore.md` + `generate-figma.md`)

**Files:**
- Modify: `skills/aqa-inspect/references/generate-explore.md`
- Modify: `skills/aqa-inspect/references/generate-figma.md`

**Interfaces:**
- Consumes: descriptor schema from Task 1.
- Produces: `cases.yaml` with `selector` pre-filled (explore path) so run 1 is already fast.

- [ ] **Step 1: Add a harvest instruction to `generate-explore.md` Step 5**

In "Step 5 — Emit `cases.yaml`", after the skeleton, add:

````markdown
### Harvest selectors while exploring

Exploration already inspects the live DOM. For each step whose target element
was located during exploration, emit a `selector` descriptor (and
`selector_anchor` when a stable visible text exists) per the schema in
`cases-yaml.md`, using the preference order `role`+`name` > `label` > `text` >
`css`. This pre-warms the cache so the **first** execution is already fast.
Steps whose element could not be confidently located are left without a
`selector` (execution fills them on run 1). Never put a `sensitive` value into a
descriptor.
````

Also add `selector` to one step of the `signup-001` skeleton (e.g. the Create
account click) to show the shape inline.

- [ ] **Step 2: Add a note to `generate-figma.md`**

Find where `generate-figma.md` emits `cases.yaml` and add a one-line note:

```markdown
> **Selector cache:** the Figma path has no live DOM, so leave every step's
> `selector` empty — the first execution resolves and caches descriptors. (Field
> defined in `cases-yaml.md`.)
```

- [ ] **Step 3: Verify both references exist and mention the cache**

Run:
```bash
grep -n "Harvest selectors\|pre-warms the cache" skills/aqa-inspect/references/generate-explore.md
grep -n "Selector cache:\|leave every step's" skills/aqa-inspect/references/generate-figma.md
```
Expected: a match in each file.

- [ ] **Step 4: Commit**

```bash
git add skills/aqa-inspect/references/generate-explore.md skills/aqa-inspect/references/generate-figma.md
git commit -m "feat(aqa-inspect): harvest selectors during live-URL exploration; note Figma leaves them empty"
```

---

## Task 5: Orchestration — single-writer write-back, sidecar, report wiring

**Files:**
- Modify: `skills/aqa-inspect/SKILL.md`

**Interfaces:**
- Consumes: `resolved_selectors` from Tasks 2 & 3.
- Produces: persisted `selector` in `cases.yaml`; `selector-drift.json` sidecar (canonical shape) consumed by Task 6.

- [ ] **Step 1: Add selector-cache persistence to Step 4 (Execute)**

In "### 4. Execute via the selected engine", after the `results.csv` paragraph,
add:

````markdown
**Selector cache persistence (single writer).** Each engine returns a per-case
`resolved_selectors` array (see the engine refs). The orchestrator — never the
parallel workers — merges these into `cases.yaml` as each case completes:

- For each entry, write `selector` (and `selector_anchor` from `anchor`) into the
  matching `steps[step]` of that `case_id`. This makes the cache available to the
  next rerun/resume of this report dir.
- When an entry has `changed: true`, append a drift record to
  `reports/{ts}/selector-drift.json`:
  `{ "case_id", "step", "old", "new": <selector> }`. A first-time fill
  (`changed: false`) is **not** drift and is not recorded.
- Because the single-threaded orchestrator is the only writer, `--parallel N`
  causes no `cases.yaml` write race.
````

- [ ] **Step 2: Document the sidecar in Step 6 and the Outputs section**

In "### 6. Write `summary.json` + render `report.html`", add a sentence:

```markdown
If `selector-drift.json` exists in the report dir, surface each record as a
per-case "selector drift" badge in the report (token `{selector_drift}`,
rendered only when present — see `report-template.html`). `summary.json` and
`results.csv` are NOT modified for drift.
```

In the "## Outputs" list, add:

```markdown
- `selector-drift.json` — present only when a cached selector was re-resolved
  differently during the run; drives the report's drift badges. Not read by
  `aqa-jira`.
```

- [ ] **Step 3: Add a one-line note about cache lifetime**

In the "## Notes" section, add:

```markdown
- The per-step `selector` cache in `cases.yaml` survives `--rerun-failed` /
  `--resume` (same report dir) and makes those runs fast. A fresh run regenerates
  `cases.yaml` and re-harvests selectors. Field schema: `references/cases-yaml.md`.
```

- [ ] **Step 4: Verify SKILL wiring**

Run:
```bash
grep -n "Selector cache persistence\|selector-drift.json\|single writer\|{selector_drift}" skills/aqa-inspect/SKILL.md
```
Expected: all four present.

- [ ] **Step 5: Confirm `summary.json` shape unchanged**

Run:
```bash
grep -n "needs_discussion\": N\|selector" skills/aqa-inspect/SKILL.md | grep -i "summary"
```
Manually confirm the `summary.json` JSON block in Step 6 has **no** new keys (drift is a separate sidecar, not a summary field).

- [ ] **Step 6: Commit**

```bash
git add skills/aqa-inspect/SKILL.md
git commit -m "feat(aqa-inspect): orchestrator persists selector cache and emits selector-drift.json"
```

---

## Task 6: Report template — drift badge

**Files:**
- Modify: `skills/aqa-inspect/references/report-template.html`

**Interfaces:**
- Consumes: `selector-drift.json` (canonical shape) via the orchestrator; the per-case `{selector_drift}` token.

- [ ] **Step 1: Add the token to the renderer-contract comment**

In the template's renderer-contract comment, add `{selector_drift}` to the
per-case token list with a one-line description: "rendered only when the case has
a drift record in `selector-drift.json`; old → new descriptor".

- [ ] **Step 2: Add an `IF` block inside the per-case block**

Inside the `<!-- BEGIN-CASE -->` … `<!-- END-CASE -->` block, near the status
line, add a conditional section (matching the existing `<!-- IF-{field} -->`
convention):

```html
<!-- IF-selector_drift -->
<div class="drift">⚠ selector drift: {selector_drift}</div>
<!-- ENDIF-selector_drift -->
```

- [ ] **Step 3: Add minimal CSS for `.drift`**

In the template `<style>`, add a muted-warning style consistent with the
existing palette (e.g. `.drift { color: #b45309; font-size: 0.85em; margin-top: 4px; }`).

- [ ] **Step 4: Verify markers are balanced**

Run:
```bash
grep -c "IF-selector_drift" skills/aqa-inspect/references/report-template.html
grep -c "ENDIF-selector_drift" skills/aqa-inspect/references/report-template.html
```
Expected: both print `1`.

- [ ] **Step 5: Commit**

```bash
git add skills/aqa-inspect/references/report-template.html
git commit -m "feat(aqa-inspect): render selector-drift badge in HTML report"
```

---

## Task 7: Version bump to 0.3.3

**Files:**
- Modify: `.claude-plugin/plugin.json:3`
- Modify: `.claude-plugin/marketplace.json:17`

- [ ] **Step 1: Bump both manifests**

Change `"version": "0.3.2"` → `"version": "0.3.3"` in both files.

- [ ] **Step 2: Verify both updated and nothing else claims 0.3.2**

Run:
```bash
grep -rn '"version"' .claude-plugin/
```
Expected: both `plugin.json` and `marketplace.json` show `0.3.3`; no `0.3.2` remains.

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: bump plugin version to 0.3.3"
```

---

## Task 8: Final consistency sweep + manual smoke

**Files:** (read-only verification across all touched docs)

- [ ] **Step 1: Descriptor schema described identically everywhere**

Run:
```bash
grep -rn "strategy" skills/aqa-inspect/ | grep -i "role | label | text | css"
```
Expected: the enum appears with the same ordering in `cases-yaml.md` and is referenced (not re-defined differently) by the engine/generation refs.

- [ ] **Step 2: Every referenced path exists**

Run:
```bash
for f in $(grep -rhoE "references/[a-z-]+\.(md|html)" skills/aqa-inspect/ | sort -u); do
  test -e "skills/aqa-inspect/$f" && echo "OK $f" || echo "MISSING $f"
done
```
Expected: all `OK`, no `MISSING`.

- [ ] **Step 3: Shared CSV contract untouched and still byte-identical**

Run:
```bash
git status --porcelain skills/aqa-inspect/references/results-csv.md skills/aqa-jira/references/csv-contract.md
diff skills/aqa-inspect/references/results-csv.md skills/aqa-jira/references/csv-contract.md && echo IDENTICAL
```
Expected: empty `git status` (no modifications) and `IDENTICAL`.

- [ ] **Step 4: Frontmatter still parses**

Run:
```bash
head -5 skills/aqa-inspect/SKILL.md
```
Expected: valid YAML frontmatter (`---` … `name:` … `description:` … `---`).

- [ ] **Step 5: Manual smoke read-through**

Read `SKILL.md` Step 4 → engine refs → `cases-yaml.md` as a chain and confirm the
`resolved_selectors` → orchestrator → `cases.yaml` / `selector-drift.json` →
report flow reads coherently end-to-end. Fix any wording gaps inline.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "docs(aqa-inspect): consistency fixes for selector cache across refs"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** decisions 1-4 → Tasks 4/2-3/1-3/5-6; embed-in-cases.yaml rationale → Task 1; single-writer race fix → Task 5; edge cases (`${var}`, `sensitive`, false-positive, querySelector miss, brittle css) → Tasks 1-3; version bump → Task 7; results.csv untouched → verified in Tasks 1, 5, 8.
- **Placeholder scan:** no TBD/TODO; every doc edit shows the exact text to insert.
- **Type consistency:** `resolved_selectors` field name, `strategy` enum, `changed`/`old` semantics, and the `selector-drift.json` shape are defined once in "Canonical shapes" and referenced identically by Tasks 2, 3, 5, 6.
