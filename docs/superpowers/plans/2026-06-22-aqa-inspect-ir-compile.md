# aqa-inspect IR Compile Output Implementation Plan

> **For agentic workers:** this plan edits a prompt-based skill (instruction docs + a per-run Node driver the skill generates). There are no unit tests for the skill itself; the deliverable is verified by an end-to-end run feeding the output to `aqa-runner`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `aqa-inspect` emit a deterministic `cases.compiled.yaml` (IR v1) as a byproduct of a successful **playwright-engine** run, so `aqa-runner` can execute it offline with no LLM.

**Architecture:** "Compile by recording." The playwright engine already resolves, per step, the locator (selector cache), the operation (`act()`), and the assertion (`assertStep()`). We extend the per-run driver to return each step's **structured** form (`op` + `selector` + `value`/`value_ref` + `assert`), and the orchestrator assembles those into `cases.compiled.yaml` in the report dir for every **passing** case. Browser-use engine is screenshot-based and cannot produce deterministic ops, so it does not compile.

**Tech Stack:** Markdown skill docs (`SKILL.md`, `references/*.md`), the generated `run-case.mjs` Playwright driver, YAML output. IR contract is owned by `ten1010-io/aqa-runner` (`schema/ir.md`); this plan mirrors IR v1.

## Global Constraints

- IR target = **v1**, stamped `ir_version: 1`. Schema must match `ten1010-io/aqa-runner/schema/ir.md` exactly.
- Finite op set: `goto` · `fill` · `click` · `select` · `check` · `hover` · `press` · `assert`.
- Finite assert types: `visible` · `hidden` · `text_contains` · `url_matches` · `enabled` · `disabled` · `value_equals` · `count`.
- Selector descriptor: `{ strategy: role|label|text|css, ... }`, preference `role`+`name` > `label` > `text` > `css` (same as `cases-yaml.md`).
- **Secrets never baked into IR.** A `sensitive` step emits `value_ref: <key>` (the `test_data` key name), never the literal secret value. The value lives only in `secrets.env` at `aqa-runner` run time.
- Compile is **playwright-engine only**. browser-use runs do NOT emit `cases.compiled.yaml`.
- Only **passing** cases (`status=pass`) are compiled — a step that never executed cleanly has no trustworthy structured form.
- `cases.compiled.yaml` is written to the report dir next to `results.csv`; it never replaces the natural-language `cases.yaml`.
- No new CLI flag (YAGNI) — emission is automatic on playwright runs.

---

## File Structure

```
skills/aqa-inspect/
├── SKILL.md                          # Modify: Step 3 output list, Step 4 IR assembly, Step 6 note, args/desc
├── references/
│   ├── compile-ir.md                 # CREATE: IR v1 schema + op/assert mapping + masking + emission rules
│   └── engine-playwright.md          # Modify: driver returns compiled_steps; write-back contract
README.md                             # Modify: note aqa-inspect emits cases.compiled.yaml for aqa-runner
.claude-plugin/plugin.json            # Modify: version bump
.claude-plugin/marketplace.json       # Modify: version bump
```

---

## Task 1: Author the IR-compile reference (`references/compile-ir.md`)

**Files:**
- Create: `skills/aqa-inspect/references/compile-ir.md`

**Interfaces:**
- Produces: the authoritative-for-this-repo description of how the playwright path turns executed steps into IR v1. Referenced by `SKILL.md` Step 4 and `engine-playwright.md`.

- [ ] **Step 1: Write `references/compile-ir.md`** with these sections:
  - **When it runs:** playwright engine only; one `cases.compiled.yaml` per run in the report dir; includes only `status=pass` cases; never emitted for browser-use.
  - **IR v1 schema** (mirror `ten1010-io/aqa-runner/schema/ir.md`): top-level `ir_version: 1`, `name`, `description`, `cases[]`; per case `case_id`, `name`, `expected_result`, `steps[]`, optional `cleanup`; per step `op` + fields per the op table; `assert` steps carry `assert: {type, ...}`.
  - **op mapping table** — natural-language `action` → structured `op`: navigate→`goto{url}`; fill/enter/type→`fill{selector,value|value_ref}`; click/press button→`click{selector}`; select/choose dropdown→`select{selector,value}`; check/uncheck/toggle→`check{selector,checked}`; hover→`hover{selector}`; key press→`press{selector?,key}`; "verify/confirm/see X"→`assert`.
  - **assert mapping table** — "is visible"→`visible`; "not visible / hidden / gone"→`hidden`; "shows/contains text T"→`text_contains{expected:T}`; "URL is/contains U"→`url_matches{expected:U}`; "enabled"→`enabled`; "disabled"→`disabled`; "field equals V"→`value_equals{expected:V}`; "N items/rows"→`count{expected:N}`. Each carries the `selector` it targeted (except `url_matches`).
  - **Secrets rule:** a step with `sensitive: true` emits `value_ref: <test_data key>` — resolve the key name from the `${key}` used in the source `action`/`test_data`; NEVER write the literal value. Add a guard note: if no `${key}` is identifiable, emit `value_ref` with the field's `test_data` key, and never fall back to the literal.
  - **Selector reuse:** the `selector` in IR is the same descriptor the selector cache already resolved (`cases-yaml.md`); reuse it verbatim (after `${var}` substitution stays as placeholder is NOT done — store concrete resolved descriptor, but keep `${var}` in `value` positions only where the source used a non-sensitive variable; for sensitive, use `value_ref`).
  - **Variable handling:** non-sensitive `${key}` values are emitted as their resolved literal `value` (the live run used a concrete value); sensitive ones become `value_ref`.
  - **File location & naming:** `reports/{ts}/cases.compiled.yaml`. One file per run.
  - **`expected_result`:** copied from the source case verbatim (`pass`/`fail`).
  - Cross-link: "Consumed by `ten1010-io/aqa-runner`; schema authority is its `schema/ir.md`. Keep IR v1 in sync."

- [ ] **Step 2: Self-check** the op/assert tables cover all 8 ops and all 8 assert types named in Global Constraints; confirm no op/assert outside those sets is introduced.

- [ ] **Step 3: Commit**

```bash
git add skills/aqa-inspect/references/compile-ir.md
git commit -m "docs(aqa-inspect): add IR v1 compile reference for cases.compiled.yaml"
```

---

## Task 2: Extend the playwright engine driver to return compiled steps

**Files:**
- Modify: `skills/aqa-inspect/references/engine-playwright.md`

**Interfaces:**
- Consumes: the existing `run-case.mjs` result JSON (already has `resolved_selectors`).
- Produces: an additional `compiled_steps` array on the per-case result JSON, one entry per executed step, in step order, each a ready-to-serialize IR step.

- [ ] **Step 1: Add a "Compiled-step capture" subsection** to `engine-playwright.md` (near "Selector write-back"). Specify that for every step the driver runs, it records the structured IR form it executed:
  - the resolved `op` (whichever of goto/fill/click/select/check/hover/press it performed, or `assert` for a verification step),
  - the resolved `selector` descriptor (same one captured for the selector cache; omit for `goto`/page-level `press`/`url_matches`),
  - `value` for non-sensitive fills/selects (the concrete value used), or `value_ref: <key>` + `sensitive: true` for sensitive steps — **never the secret value**,
  - for assert steps, the `assert: {type, ...}` object per `compile-ir.md`.
- [ ] **Step 2: Extend the result-JSON shape** documented in the driver skeleton: add
  ```json
  "compiled_steps": [
    { "op": "goto", "url": "https://app.example.com/login" },
    { "op": "fill", "selector": {"strategy":"label","label":"Email"}, "value": "testuser@example.com" },
    { "op": "fill", "selector": {"strategy":"label","label":"Password"}, "value_ref": "password", "sensitive": true },
    { "op": "click", "selector": {"strategy":"role","role":"button","name":"Sign in"} },
    { "op": "assert", "assert": {"type":"visible","selector":{"strategy":"text","text":"Dashboard"}} }
  ]
  ```
  with a note: this array is populated **only when the case passes**; on failure the driver may return a partial array, which the orchestrator discards (only passing cases compile).
- [ ] **Step 3: State the masking invariant** in this ref too: `compiled_steps` must never contain a secret value; sensitive steps carry `value_ref` only — consistent with the existing `sensitive`/`****` rule.
- [ ] **Step 4: Commit**

```bash
git add skills/aqa-inspect/references/engine-playwright.md
git commit -m "docs(aqa-inspect): playwright driver returns compiled_steps for IR"
```

---

## Task 3: Orchestrator assembles `cases.compiled.yaml` (SKILL.md)

**Files:**
- Modify: `skills/aqa-inspect/SKILL.md` (Step 3 output tree; Step 4 single-writer section; Step 6 note)

**Interfaces:**
- Consumes: `compiled_steps` from each passing case's engine result (Task 2); the IR rules in `compile-ir.md` (Task 1).
- Produces: `reports/{ts}/cases.compiled.yaml` on playwright runs.

- [ ] **Step 1: Add `cases.compiled.yaml` to the Step 3 report-dir tree**, annotated "playwright engine only — the offline IR consumed by `aqa-runner`".
- [ ] **Step 2: Add an "IR compile output (playwright only)" paragraph to Step 4**, right after the selector-cache single-writer block. Specify:
  - The orchestrator (single writer) collects `compiled_steps` from each case whose `status=pass`.
  - It assembles `cases.compiled.yaml` per `references/compile-ir.md`: top-level `ir_version: 1`, copy `name`/`description` from `cases.yaml`, and for each passing case emit `case_id`, `name`, `expected_result`, the `compiled_steps` as `steps`, and `cleanup` copied from the source case.
  - Skip `fail` / `needs_discussion` cases (no trustworthy structured form).
  - Write the file in the report dir alongside `results.csv`.
  - **browser-use runs:** do NOT write this file (the engine returns no `compiled_steps`); state this explicitly.
  - **rerun/resume:** regenerate `cases.compiled.yaml` from the union of passing cases in the report dir (existing pass rows + newly passing), so the IR reflects all green cases, keyed by `case_id`.
  - Masking: never write a secret value; sensitive steps stay `value_ref`.
- [ ] **Step 3: Add a one-line pointer in Step 6 / outputs** that `cases.compiled.yaml` (when present) is the artifact to hand to `aqa-runner`; it is not read by `aqa-jira`.
- [ ] **Step 4: Update the SKILL.md top description + the "References" list** to mention `references/compile-ir.md` and that playwright runs emit an offline IR.
- [ ] **Step 5: Commit**

```bash
git add skills/aqa-inspect/SKILL.md
git commit -m "feat(aqa-inspect): emit cases.compiled.yaml (IR) on playwright runs"
```

---

## Task 4: README + version bump

**Files:**
- Modify: `README.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

- [ ] **Step 1: Update the README** — in the `/aqa-inspect` Output bullet and/or the "Related: offline execution with `aqa-runner`" section, note that a **playwright-engine** run also writes `cases.compiled.yaml` (IR), which is exactly the file `aqa-runner` consumes. Tighten the aqa-runner section's flow line to say the IR now comes straight out of a playwright run (no manual authoring).
- [ ] **Step 2: Bump version** `0.3.4` → `0.4.0` in both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (pipeline-completing feature).
- [ ] **Step 3: Commit**

```bash
git add README.md .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "docs: note aqa-inspect IR output; bump version to 0.4.0"
```

---

## Task 5: End-to-end verification (the real test)

**Files:** none (verification only).

There are no unit tests for a prompt-based skill; verify by producing real IR and running it through `aqa-runner`.

- [ ] **Step 1:** Run aqa-inspect against a simple public target with the **playwright** engine and a tiny generated/approved `cases.yaml` (e.g. a 1–2 case happy path on a public page). Confirm `reports/{ts}/cases.compiled.yaml` is written.
- [ ] **Step 2:** Validate the file against IR v1: it has `ir_version: 1`, every step has a known `op`, asserts use known types, and **no secret literal** appears (grep for any sensitive value → must be `value_ref`).
- [ ] **Step 3:** Feed it to the runner: `node <aqa-runner>/src/run.js reports/{ts}/cases.compiled.yaml --out /tmp/ir-verify`. Confirm it loads (not rejected as "not compiled") and runs to a result.
- [ ] **Step 4:** Confirm a browser-use run of the same cases does NOT write `cases.compiled.yaml`.
- [ ] **Step 5:** Record the verification outcome in the PR description.

---

## Self-Review

**Spec coverage (against the aqa-runner design's "Known follow-up"):**
- "emit cases.compiled.yaml by recording a successful live run — capture per step the resolved op, selector, value/value_ref, assert" → Tasks 1–3. ✅
- IR v1 schema parity with aqa-runner → Task 1 (mirrors `schema/ir.md`), Global Constraints. ✅
- Secrets never baked → Global Constraints + Tasks 1,2,3 masking rules. ✅
- playwright-only, passing-cases-only → Global Constraints + Task 3. ✅
- Discoverability (README) + version → Task 4. ✅
- Real verification → Task 5. ✅

**Placeholder scan:** none — the op/assert tables and result-JSON shape are concretely specified; verification uses concrete commands.

**Consistency:** `compiled_steps` (Task 2 driver output) → consumed verbatim as `steps` by Task 3 orchestrator. Op set and assert types are identical across Tasks 1, 2, 3 and match the aqa-runner IR. `value_ref` masking rule is stated identically in Tasks 1, 2, 3.
