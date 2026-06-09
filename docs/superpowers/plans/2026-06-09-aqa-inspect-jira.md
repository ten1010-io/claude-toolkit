# AQA Inspect + AQA Jira Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> When authoring the skill files, also consult `superpowers:writing-skills` for skill structure/frontmatter conventions.

**Goal:** Add two independent skills to `claude-toolkit` — `aqa-inspect` (generate → execute → report QA cases) and `aqa-jira` (turn failures into Jira tickets behind a human gate) — sharing a `results.csv` contract.

**Architecture:** Skills are markdown instruction docs (`SKILL.md` + `references/`) following the existing `aqa-run`/`aqa-spec` pattern. `aqa-inspect` reuses the AQA YAML scenario schema and browser-use execution patterns from `aqa-run`, adds a Playwright runtime-DOM engine, a tester/timestamp/result CSV, a `needs_discussion` reclassification stage, and `--rerun-failed` resume. `aqa-jira` reads the CSV (`fail` rows only) and creates tickets via the Atlassian MCP after human approval.

**Tech Stack:** Markdown skill docs; browser-use CLI; Node Playwright (`npx playwright`, v1.60.0); Atlassian MCP (`createJiraIssue`, JQL search, attachments); YAML/CSV/HTML artifacts.

**Verification model:** These are documentation skills, not unit-testable code. "Tests" per task = (a) YAML frontmatter parses, (b) every `references/...` path mentioned in a SKILL.md exists, (c) no contradiction with the shared CSV schema, and (d) a final manual smoke run. Reference existing files instead of reproducing them: `skills/aqa-run/SKILL.md`, `skills/aqa-spec/SKILL.md`, `commands/aqa-run.md`, `.claude-plugin/marketplace.json`.

**Source of truth:** [docs/superpowers/specs/2026-06-09-aqa-inspect-jira-design.md](../specs/2026-06-09-aqa-inspect-jira-design.md)

---

## File Structure

New files:

```
skills/aqa-inspect/
  SKILL.md                     # dispatch (figma vs explore) + workflow overview
  references/
    results-csv.md             # AUTHORITATIVE results.csv schema
    generate-figma.md          # Figma → cases.yaml
    generate-explore.md        # live-URL exploration → cases.yaml
    engine-browser-use.md      # browser-use execution contract
    engine-playwright.md       # Playwright runtime DOM-resolution contract
    report-template.html       # HTML report template (meta header + summary)
skills/aqa-jira/
  SKILL.md                     # flow + Atlassian MCP call contract + human gate
  references/
    csv-contract.md            # COPY of results-csv.md (shared contract)
    ticket-template.md         # Jira ticket body template
commands/
  aqa-inspect.md               # /aqa-inspect command
  aqa-jira.md                  # /aqa-jira command
```

Modified files:

```
.claude-plugin/marketplace.json   # register both skills/commands
README.md                          # document the two new skills
```

Shared contract: `skills/aqa-inspect/references/results-csv.md` is authoritative;
`skills/aqa-jira/references/csv-contract.md` is a byte-identical copy. Both must
stay in sync.

The canonical `results.csv` columns (referenced by every task that touches the CSV):

```
case_id, name, status, tester, finished_at, failure_reason, expected_vs_actual, evidence_path, discuss_note, jira_key
```

`status` ∈ `pass | fail | needs_discussion`.

---

## Phase 0: Shared contract

### Task 1: results.csv schema doc

**Files:**
- Create: `skills/aqa-inspect/references/results-csv.md`

- [ ] **Step 1: Write the schema doc**

Content must define, in this order:
- The exact column list (copy verbatim from the "canonical columns" block above).
- Per-column: name, meaning, when populated, allowed values. Use this table:

| Column | Meaning | Populated | Values |
|---|---|---|---|
| `case_id` | stable id, used for rerun match + Jira dedup | generation | e.g. `login-001` |
| `name` | case title → Jira summary | generation | free text |
| `status` | result | execution / reclassify | `pass`/`fail`/`needs_discussion` |
| `tester` | who ran it | run start | free text |
| `finished_at` | case completion time | per case | ISO-8601 |
| `failure_reason` | why it failed | when `fail` | free text, else empty |
| `expected_vs_actual` | expected vs observed | when `fail`/`needs_discussion` | free text |
| `evidence_path` | screenshot/log path | when `--screenshot` or on fail | relative path |
| `discuss_note` | why ambiguous | when `needs_discussion` | free text |
| `jira_key` | created ticket | by `aqa-jira` | e.g. `PROJ-123`, else empty |

- CSV rules: UTF-8, header row required, RFC-4180 quoting (fields with commas/newlines/quotes wrapped in double quotes, embedded `"` doubled). Empty string for unset optional fields.
- A 3-row example (one pass, one fail, one needs_discussion).
- A note: this file is the authoritative contract; `skills/aqa-jira/references/csv-contract.md` must be a byte-identical copy.

- [ ] **Step 2: Verify**

Run: `test -f skills/aqa-inspect/references/results-csv.md && grep -q 'expected_vs_actual' skills/aqa-inspect/references/results-csv.md && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add skills/aqa-inspect/references/results-csv.md
git commit -m "feat(aqa-inspect): add results.csv schema contract"
```

---

## Phase 1: aqa-inspect

### Task 2: report-template.html

**Files:**
- Create: `skills/aqa-inspect/references/report-template.html`
- Reference: `skills/aqa-run/references/report-template.html`

- [ ] **Step 1: Adapt the aqa-run template**

Start from `skills/aqa-run/references/report-template.html`. Add a **meta header** block at the top rendering: `executed_at`, `base_url`, `engine`, `browser`, `commit_hash`, and counts `total / passed / failed / needs_discussion`. Add a `needs_discussion` column/badge alongside pass/fail. Keep placeholder tokens consistent with the existing template's substitution style (e.g. `{{FEATURE}}`, `{{ROWS}}`) and add `{{META_*}}` tokens for the new header fields.

- [ ] **Step 2: Verify**

Run: `grep -qi 'needs_discussion\|needs-discussion' skills/aqa-inspect/references/report-template.html && grep -q 'commit_hash\|COMMIT' skills/aqa-inspect/references/report-template.html && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add skills/aqa-inspect/references/report-template.html
git commit -m "feat(aqa-inspect): add HTML report template with meta header"
```

### Task 3: generate-figma.md

**Files:**
- Create: `skills/aqa-inspect/references/generate-figma.md`
- Reference: `skills/aqa-spec/SKILL.md` (Figma Mode Workflow section)

- [ ] **Step 1: Write the Figma-generation reference**

Document the procedure to turn a `--figma <url>` into `cases.yaml`:
- Fetch/analyze the Figma frame (reuse the analysis approach from `aqa-spec`'s Figma Mode Workflow — point to it explicitly, do not duplicate the whole thing).
- Derive candidate user flows → cases, each with `case_id`, `name`, `priority` (informational only; not filtered), `test_data`, multi-step `steps` (natural language), `expected_result`.
- Emit `cases.yaml` in the AQA scenario schema (Format A "cases" structure from `skills/aqa-run/SKILL.md`).
- Mandatory human review of drafted cases before execution (Figma → cases can be wrong).
- Require `--target <url>` for the live site; store as `BASE_URL` in each case's `test_data`.

- [ ] **Step 2: Verify**

Run: `test -f skills/aqa-inspect/references/generate-figma.md && grep -q 'cases.yaml' skills/aqa-inspect/references/generate-figma.md && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add skills/aqa-inspect/references/generate-figma.md
git commit -m "feat(aqa-inspect): add Figma case-generation reference"
```

### Task 4: generate-explore.md

**Files:**
- Create: `skills/aqa-inspect/references/generate-explore.md`

- [ ] **Step 1: Write the URL-exploration reference**

Document the procedure to auto-draft `cases.yaml` from a live `--target <url>` (no Figma):
- Open the target with the selected engine (browser-use `open` or Playwright `goto`).
- Inspect the DOM / accessibility tree: enumerate interactive elements (forms, inputs, buttons, links, nav), required fields, and visible flows.
- Derive cases: at minimum a happy-path per primary form/flow plus obvious negative cases (empty required field, invalid input). Each case gets `case_id`, `name`, `steps`, `expected_result`, `test_data`.
- Emit `cases.yaml` (AQA Format A). Store the target as `BASE_URL`.
- Mandatory human review of drafted cases before execution.

- [ ] **Step 2: Verify**

Run: `test -f skills/aqa-inspect/references/generate-explore.md && grep -q 'accessibility\|DOM' skills/aqa-inspect/references/generate-explore.md && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add skills/aqa-inspect/references/generate-explore.md
git commit -m "feat(aqa-inspect): add live-URL exploration case-generation reference"
```

### Task 5: engine-browser-use.md

**Files:**
- Create: `skills/aqa-inspect/references/engine-browser-use.md`
- Reference: `skills/aqa-run/SKILL.md` (steps 0, 4-1..4-5)

- [ ] **Step 1: Write the browser-use engine contract**

Document, reusing `aqa-run` patterns (point to them, don't fully duplicate):
- Dependency check + `BROWSER_USE_CMD` resolution (copy the search order and install message from `aqa-run` step 0).
- Per-case: open session `--session case_{id}`, SSL warning handling, per-step execution (state → input/click), screenshot capture when `--screenshot`, cleanup (cookies clear + close).
- Result determination → `status` (`pass`/`fail`/`needs_discussion`) and how to populate each `results.csv` field, especially `evidence_path`, `failure_reason`, `expected_vs_actual`, and `discuss_note` (set when pass/fail can't be confidently decided from screenshots/state).

- [ ] **Step 2: Verify**

Run: `grep -q 'BROWSER_USE_CMD' skills/aqa-inspect/references/engine-browser-use.md && grep -q 'needs_discussion' skills/aqa-inspect/references/engine-browser-use.md && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add skills/aqa-inspect/references/engine-browser-use.md
git commit -m "feat(aqa-inspect): add browser-use engine contract"
```

### Task 6: engine-playwright.md

**Files:**
- Create: `skills/aqa-inspect/references/engine-playwright.md`

- [ ] **Step 1: Write the Playwright engine contract**

Document the runtime-DOM-resolution engine:
- Dependency check: `npx playwright --version` (expect v1.60.0+). If missing, print install instructions (`npm i -D playwright && npx playwright install chromium`) and stop.
- Execution model: drive a Chromium page; for each natural-language step, read `page.accessibility.snapshot()` / DOM, resolve the step to a concrete locator (`getByRole`/`getByText`/`getByLabel`/CSS), act, then assert. No selectors are pre-baked in `cases.yaml`.
- Recommend a small generated Node driver script (`run-case.mjs`) the skill writes per run, OR an MCP/eval-driven loop — specify one concrete approach: write a per-run `run-case.mjs` that takes a case JSON on stdin, returns a JSON result on stdout, capturing screenshots to `artifacts/{case_id}/`.
- Map the JSON result → `results.csv` fields exactly as the browser-use engine does (same `status` semantics, same `needs_discussion` rule).
- `--headed/--headless` and `--parallel N` handling (separate browser contexts per concurrent case).

- [ ] **Step 2: Verify**

Run: `grep -q 'accessibility\|getByRole' skills/aqa-inspect/references/engine-playwright.md && grep -q 'needs_discussion' skills/aqa-inspect/references/engine-playwright.md && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add skills/aqa-inspect/references/engine-playwright.md
git commit -m "feat(aqa-inspect): add Playwright runtime-DOM engine contract"
```

### Task 7: aqa-inspect SKILL.md

**Files:**
- Create: `skills/aqa-inspect/SKILL.md`
- Reference: `skills/aqa-run/SKILL.md`, `skills/aqa-spec/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

Frontmatter:
```yaml
---
name: aqa-inspect
description: End-to-end AI QA — generate test cases (from a Figma design or by exploring a live URL), execute them with a selectable engine (browser-use screenshots or Playwright DOM), track per-case results (pass/fail/needs_discussion, tester, time, reasons) into results.csv, and emit an HTML report. Use whenever the user wants to inspect/QA a page or design end to end — "QA 돌려줘", "이 페이지 점검해줘", "피그마로 테스트 만들고 실행까지", "run full QA".
---
```

Body sections (keep each focused; delegate detail to `references/`):
1. **Language** — detect user language, mirror it (copy the note from `aqa-run`).
2. **Arguments** — table: `--figma/-f`, `--target`, `--engine browser-use|playwright` (default browser-use), `--tester` (else ask at start), `--screenshot`, `--headed/--headless`, `--parallel N` (default 2), `--rerun-failed`, `--resume <reports_dir>`.
3. **Workflow** (numbered):
   - 0. Resolve engine + dependency check (delegate: `engine-browser-use.md` / `engine-playwright.md`).
   - 1. Tester: use `--tester` or ask once.
   - 2. Generate cases: if `--figma` → `references/generate-figma.md`; else require `--target` → `references/generate-explore.md`. Produce `cases.yaml`. **Mandatory human review of drafted cases before execution.**
   - 3. Create `reports/{YYYY-MM-DD_HH-MM-SS}/`. If `--resume <dir>`/`--rerun-failed`, reuse that dir: read existing `results.csv`, skip rows with `status=pass`, re-run only `fail`/`needs_discussion`.
   - 4. Execute via selected engine (delegate to engine ref). Write/update `results.csv` per the schema (`references/results-csv.md`). Capture meta: `base_url`, `engine`, `browser`, `commit_hash` (`git rev-parse --short HEAD` if in a repo, else empty), `executed_at`.
   - 5. **needs_discussion reclassification stage** — list every `needs_discussion` case to the human with its `discuss_note`; collect pass/fail; write resolutions back to `results.csv`. Skippable; unresolved rows stay `needs_discussion`.
   - 6. Render `report.html` from `references/report-template.html` (fill meta header + rows).
   - 7. Print summary: total / passed / failed / needs_discussion + report path.
4. **References** — list all six reference files with one-line purpose each.
5. **Notes** — mask `sensitive: true` values as `****`; never auto-create Jira tickets (that is `aqa-jira`, behind a human gate).

- [ ] **Step 2: Verify frontmatter + references resolve**

Run:
```bash
python3 -c "import yaml,sys,re; t=open('skills/aqa-inspect/SKILL.md').read(); fm=re.match(r'---\n(.*?)\n---',t,re.S).group(1); d=yaml.safe_load(fm); assert d['name']=='aqa-inspect' and d.get('description'); print('frontmatter OK')"
for f in results-csv generate-figma generate-explore engine-browser-use engine-playwright report-template.html; do test -f "skills/aqa-inspect/references/${f%.html}"* || { echo "MISSING $f"; exit 1; }; done; echo "refs OK"
```
Expected: `frontmatter OK` then `refs OK`

- [ ] **Step 3: Commit**

```bash
git add skills/aqa-inspect/SKILL.md
git commit -m "feat(aqa-inspect): add SKILL.md orchestrating generation, execution, report"
```

### Task 8: /aqa-inspect command

**Files:**
- Create: `commands/aqa-inspect.md`
- Reference: `commands/aqa-run.md`, `commands/aqa-spec.md`

- [ ] **Step 1: Write the command file**

Match the structure of `commands/aqa-run.md` (frontmatter + short description + arg passthrough that triggers the `aqa-inspect` skill). List the same arguments as the skill. State explicitly that this never creates Jira tickets.

- [ ] **Step 2: Verify**

Run: `test -f commands/aqa-inspect.md && head -1 commands/aqa-run.md | head -c1 | grep -q . && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add commands/aqa-inspect.md
git commit -m "feat: add /aqa-inspect command"
```

---

## Phase 2: aqa-jira

### Task 9: csv-contract.md (shared copy)

**Files:**
- Create: `skills/aqa-jira/references/csv-contract.md`
- Source: `skills/aqa-inspect/references/results-csv.md`

- [ ] **Step 1: Copy the authoritative schema**

Run:
```bash
mkdir -p skills/aqa-jira/references
cp skills/aqa-inspect/references/results-csv.md skills/aqa-jira/references/csv-contract.md
```

- [ ] **Step 2: Verify byte-identical**

Run: `diff -q skills/aqa-inspect/references/results-csv.md skills/aqa-jira/references/csv-contract.md && echo IDENTICAL`
Expected: `IDENTICAL`

- [ ] **Step 3: Commit**

```bash
git add skills/aqa-jira/references/csv-contract.md
git commit -m "feat(aqa-jira): add shared results.csv contract copy"
```

### Task 10: ticket-template.md

**Files:**
- Create: `skills/aqa-jira/references/ticket-template.md`

- [ ] **Step 1: Write the ticket body template**

Define the Jira ticket draft mapping from a `fail` CSV row:
- `summary` = `name` (optionally prefixed `[AQA] `).
- `description` (Jira markup) containing: failure_reason, the case steps (from `cases.yaml`), expected_vs_actual, and run info (engine, tester, finished_at, base_url, commit_hash, report.html path).
- Attachment: the `evidence_path` screenshot(s).
- A dedup rule: JQL `project = {KEY} AND summary ~ "{name}" AND statusCategory != Done` → if a match exists, skip and note the existing key.

- [ ] **Step 2: Verify**

Run: `grep -q 'summary' skills/aqa-jira/references/ticket-template.md && grep -qi 'jql\|dedup\|duplicate' skills/aqa-jira/references/ticket-template.md && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add skills/aqa-jira/references/ticket-template.md
git commit -m "feat(aqa-jira): add Jira ticket body + dedup template"
```

### Task 11: aqa-jira SKILL.md

**Files:**
- Create: `skills/aqa-jira/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

Frontmatter:
```yaml
---
name: aqa-jira
description: Read aqa-inspect results.csv and create Jira tickets for failed test cases, behind a human approval gate. Filters status=fail only (pass and needs_discussion excluded), drafts tickets with failure details + screenshots, dedups against existing tickets, and writes the created ticket key back into results.csv. Use when the user says "실패한 테스트 지라에 올려줘", "create Jira tickets from QA results", "티켓 생성해줘".
---
```

Body sections:
1. **Language** — detect + mirror user language.
2. **Arguments** — `--results <path>` or a positional `<reports_dir>` (locate `results.csv`); `--project <KEY>` (ask if absent); `--issue-type <type>` (ask if absent, default Bug).
3. **Why separate from aqa-inspect** — an LLM can misjudge a test, so ticket creation is gated by human review; this skill never runs tests.
4. **Workflow:**
   - 1. Read `results.csv` (schema: `references/csv-contract.md`). Filter `status=fail` only. If none, report and stop.
   - 2. For each fail, build a draft via `references/ticket-template.md`.
   - 3. Dedup: run the JQL from the template; mark already-ticketed cases as skip.
   - 4. **Human gate:** present the full draft list (summary + which are new vs skipped) and ask for explicit approval before creating anything.
   - 5. On approval, create each via Atlassian MCP `createJiraIssue`, attach screenshots, then write the returned key into the row's `jira_key` and save `results.csv`.
   - 6. Print created/skipped summary with ticket links.
5. **MCP contract** — name the exact Atlassian MCP tools used (`createJiraIssue`, the JQL search tool, the attachment tool) and that schemas are loaded via ToolSearch at runtime.
6. **Notes** — never create tickets without explicit human approval; `pass`/`needs_discussion` rows are never ticketed.

- [ ] **Step 2: Verify frontmatter + references**

Run:
```bash
python3 -c "import yaml,re; t=open('skills/aqa-jira/SKILL.md').read(); d=yaml.safe_load(re.match(r'---\n(.*?)\n---',t,re.S).group(1)); assert d['name']=='aqa-jira' and d.get('description'); print('frontmatter OK')"
test -f skills/aqa-jira/references/csv-contract.md && test -f skills/aqa-jira/references/ticket-template.md && echo "refs OK"
```
Expected: `frontmatter OK` then `refs OK`

- [ ] **Step 3: Commit**

```bash
git add skills/aqa-jira/SKILL.md
git commit -m "feat(aqa-jira): add SKILL.md with human-gated ticket creation"
```

### Task 12: /aqa-jira command

**Files:**
- Create: `commands/aqa-jira.md`
- Reference: `commands/aqa-run.md`

- [ ] **Step 1: Write the command file**

Match `commands/aqa-run.md` structure. Args: results path / reports dir, `--project`, `--issue-type`. State the human-approval gate explicitly.

- [ ] **Step 2: Verify**

Run: `test -f commands/aqa-jira.md && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add commands/aqa-jira.md
git commit -m "feat: add /aqa-jira command"
```

---

## Phase 3: Registration + smoke test

### Task 13: Register skills/commands in marketplace + README

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Modify: `README.md`

- [ ] **Step 1: Inspect current registration format**

Run: `cat .claude-plugin/marketplace.json`
Note how existing skills/commands (`aqa-run`, `aqa-spec`, `pr`, `merge-check`) are listed.

- [ ] **Step 2: Add `aqa-inspect` and `aqa-jira`**

Add entries for both skills and both commands following the exact format observed in Step 1. Update `README.md` with a short description of each new skill and the `aqa-inspect → review → aqa-jira` pipeline.

- [ ] **Step 3: Verify JSON valid**

Run: `python3 -c "import json; json.load(open('.claude-plugin/marketplace.json')); print('JSON OK')"`
Expected: `JSON OK`

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/marketplace.json README.md
git commit -m "docs: register aqa-inspect + aqa-jira skills and commands"
```

### Task 14: End-to-end smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Reference-link integrity across both skills**

Run:
```bash
for skill in aqa-inspect aqa-jira; do
  for ref in $(grep -oE 'references/[A-Za-z0-9._-]+' skills/$skill/SKILL.md | sort -u); do
    test -f "skills/$skill/$ref" || echo "BROKEN: skills/$skill/$ref"
  done
done
echo "link check done"
```
Expected: `link check done` with no `BROKEN:` lines.

- [ ] **Step 2: Contract still identical**

Run: `diff -q skills/aqa-inspect/references/results-csv.md skills/aqa-jira/references/csv-contract.md && echo IDENTICAL`
Expected: `IDENTICAL`

- [ ] **Step 3: Live smoke (manual, requires a target URL)**

In a fresh session, invoke `/aqa-inspect --target <some test URL> --engine playwright --tester smoke`. Confirm: cases drafted → human review prompt → execution → `reports/<ts>/results.csv` with the 10 columns → `report.html` opens with the meta header. Then `/aqa-jira <that reports dir> --project <KEY>` and confirm the draft list + approval gate appears before any ticket is created. (Do not approve unless intentionally testing creation.)

- [ ] **Step 4: Commit any fixes found**

```bash
git add -A
git commit -m "fix(aqa): smoke-test corrections"
```

---

## Notes for the implementer

- DRY: reuse `aqa-run`/`aqa-spec` text by pointing to it, not copying, except the CSV contract which is intentionally duplicated and must stay byte-identical.
- YAGNI: no flaky/`--retry`, no priority filtering — explicitly deferred.
- The `needs_discussion` rule is the same in both engines: assign it only when pass/fail cannot be confidently determined, and always record `discuss_note`.
- Human gates are mandatory in two places: drafted-case review (aqa-inspect, before execution) and ticket creation (aqa-jira, before any write to Jira).
