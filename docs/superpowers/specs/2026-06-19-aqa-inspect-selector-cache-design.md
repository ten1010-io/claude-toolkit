# aqa-inspect — Selector Cache (Learned, Engine-Neutral) Design

**Date:** 2026-06-19
**Status:** Approved design, pre-implementation
**Plugin version target:** `0.3.2` → `0.3.3` (bump on this work)

## Problem

The `playwright` engine resolves every natural-language step to a concrete
locator **at runtime** on **every run** (`engine-playwright.md:11-15,56-57`). It
reads the live DOM / a11y snapshot and re-derives the locator each time, so a
second run (rerun/resume) is no faster than the first. Users expect the common
Playwright workflow: the first pass discovers selectors, later passes reuse them
and run fast.

The `browser-use` engine has the same "no cached address" property by a
different mechanism — it locates elements by an **ephemeral element index** read
from `state` each step (`engine-browser-use.md:80-86`); the index changes per
page-state read and cannot be cached at all.

Goal: make the **second and later** executions fast for **both** engines, while
keeping the natural-language authoring experience and not breaking the
`results.csv` contract shared with `aqa-jira`.

## Decisions (locked)

1. **Who/when fills selectors → C (harvest + learn).** Generation harvests
   selectors where it already touches live DOM; execution fills any blanks on
   the first run.
2. **Stale-selector behavior → C (heal + signal).** A cached selector that no
   longer resolves triggers re-resolution from the natural-language step and a
   cache overwrite; the change ("drift") is recorded and surfaced, so DOM
   regressions are not silently hidden.
3. **Selector representation → B (engine-neutral descriptor).** Store a
   structured descriptor (`role`/`label`/`text`/`css`), not Playwright code, so
   both engines benefit. Playwright maps it to `getByRole/getByLabel/getByText/
   locator(css)`; browser-use maps it to a `querySelector` → index resolution
   that short-circuits AI state interpretation.
4. **Drift surfacing → A (report only).** Drift goes into a new
   `selector-drift.json` sidecar and is rendered as a per-case badge in
   `report.html`. `results.csv` and `summary.json` are untouched, so `aqa-jira`
   is unaffected.

## Why embed in `cases.yaml` (not a standalone selector store)

`cases.yaml` lives inside the run's report dir and is re-read as-is on
`--rerun-failed` / `--resume` (`SKILL.md:99,129`). Embedding the learned
selectors there means the cache **survives reruns of that run automatically**
via the existing join (`case_id` + step), with no extra file to manage. A fresh
run regenerates `cases.yaml` (and re-harvests selectors), which is the correct
behavior — a new DOM understanding should not inherit stale selectors. This
directly satisfies "first run slow, subsequent fast" where *subsequent* =
rerun/resume.

The existing contract line "no pre-baked selectors" refers to **human-authored**
selectors. This design adds a **machine-learned cache**, a different thing — the
contract is *extended*, not contradicted. The `selector` field is always
optional; a step without it behaves exactly as today (full backward compat).

## Schema change — `cases.yaml` step

Add two **optional** per-step fields:

```yaml
steps:
  - action: "Click the Sign in button"
    selector:                  # optional; machine-filled (harvest or run 1). Absent ⇒ runtime NL resolution
      strategy: role           # role | label | text | css
      role: button             # when strategy=role
      name: "Sign in"
      # label: "..."           # when strategy=label
      # text: "..."            # when strategy=text
      # css: "..."             # when strategy=css (last resort, low confidence)
    selector_anchor: "Sign in" # optional; expected visible text used for heal / false-positive guard
```

Resolution preference order when learning a descriptor: `role`+`name` >
`label` > `text` > `css` (mirrors the existing locator preference in
`engine-playwright.md:45-49`).

## Generation-time harvest (decision 1, harvest half)

- `generate-explore.md` Step 5: while exploring the live target it already
  inspects the DOM — capture the locator descriptor for each step and emit it in
  the `selector` field of the drafted `cases.yaml`. Result: the explore path is
  fast from run 1.
- `generate-figma.md`: no live DOM available — leave `selector` empty; the first
  execution fills it.

## Execution flow (both engines; only the mapping differs)

Per step:

1. **`selector` present** → try it first.
   - Playwright: map `strategy` → `getByRole/getByLabel/getByText/locator(css)`.
   - browser-use: `eval "document.querySelector(...)"` to obtain the element
     index directly, skipping the AI `state` interpretation.
2. **Found and `selector_anchor` text matches** → act. (first false-positive
   guard)
3. **`selector` absent, not found, or anchor mismatch** → fall back to
   natural-language resolution (today's path) → **write the resolved descriptor
   back** into the step.
4. **If write-back changed an existing descriptor** (not a first-time fill) →
   record **drift** (see below).

`${var}` substitution and `sensitive` masking apply to the resolved descriptor
exactly as they do to `action` (see Edge Cases).

### Write-back is done by the orchestrator (single writer)

Workers never write `cases.yaml` directly. The Playwright `run-case.mjs` already
returns a result JSON on stdout per case (`engine-playwright.md:64,136`) — extend
that JSON to carry the resolved descriptors; browser-use returns the same per
case. The single-threaded orchestrator merges descriptors into `cases.yaml` as
each case completes. This removes any `--parallel N` write race.

## Drift surfacing (decision 4)

- New sidecar `reports/{ts}/selector-drift.json`:
  ```json
  [{ "case_id": "login-001", "step": 4, "old": { ... }, "new": { ... } }]
  ```
- Appended **only when write-back changed an existing descriptor** (a first-time
  fill of an empty `selector` is not drift).
- `report.html` renders a per-case "⚠ selector drift" badge (old → new) sourced
  from this sidecar, via a new `<!-- IF-selector_drift -->` conditional section.
- `aqa-jira` never reads this file; `results.csv` and `summary.json` are
  untouched.

## Edge cases

| Case | Handling |
|---|---|
| `${var}` substitution | The descriptor targets the **field**, not the value — store pre-substitution. If a `name` legitimately contains `${var}`, store the placeholder verbatim and substitute at replay, same as `action`. |
| `sensitive` masking | Never put a secret value into `selector`/`selector_anchor` (field identifiers only). A password field is `{role: textbox, name: Password}`. Safe. |
| False-positive (wrong element matched) | First guard: `selector_anchor` text check. Second guard: the existing post-condition assertion still runs — a wrong-element action lands in a wrong state and is caught. The cache never bypasses assertions. |
| browser-use `querySelector` miss | Fall back to AI `state` interpretation (flow step 3). |
| Brittle css (`nth-child` etc.) | Stored as `strategy: css` (low confidence); on replay failure it is re-resolved. |

## Files touched

| File | Change |
|---|---|
| `cases-yaml.md` | Add optional `selector` / `selector_anchor` step fields; substitution + sensitive rules for them. |
| `engine-playwright.md` | Try `selector` first → strategy mapping; return resolved descriptors in result JSON; drift detection. |
| `engine-browser-use.md` | `selector` → `querySelector` → index path; return descriptors; drift detection. |
| `generate-explore.md` | Step 5 harvests selectors into the emitted `cases.yaml`. |
| `generate-figma.md` | State that `selector` is left empty (no live DOM). |
| `SKILL.md` | Describe the learned-cache behavior, the `selector-drift.json` output, and the report badge; update Outputs. |
| `report-template.html` | Drift badge + `<!-- IF-selector_drift -->` conditional block. |
| `results-csv.md` | **No change** (intentional — keeps `aqa-jira` contract intact). |
| `.claude-plugin/plugin.json` | Version bump `0.3.2` → `0.3.3`. |
| `.claude-plugin/marketplace.json` | Version bump `0.3.2` → `0.3.3`. |

## Non-goals

- Bottleneck measurement (snapshot read vs NL resolution): out of scope — the
  user already chooses the engine, and the cache helps either way.
- Changing `results.csv` / `summary.json` schemas.
- Human-authored selectors as a primary workflow (the field stays
  machine-managed).
