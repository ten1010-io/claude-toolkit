# aqa-runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `ten1010-io/aqa-runner` — a standalone, LLM-free, offline Playwright runner that executes a compiled `cases.compiled.yaml` (IR) and emits `results.csv` + `report.html`, packaged as per-OS bundles by GitHub Actions.

**Architecture:** A thin CLI (`run.js`) loads and validates the IR, then runs each case in its own Chromium context. Each step is a structured `op` mapped directly to a Playwright call — no natural-language interpretation. Pure logic (IR loading, selector mapping, ops, asserts, secrets, CSV, HTML) lives in small single-responsibility modules unit-tested with fakes; only the case orchestration touches a real browser.

**Tech Stack:** Node.js (ESM, `"type": "module"`), Playwright (only runtime dependency), Node built-in `node:test` + `node:assert` for tests (zero extra deps — air-gap friendly), YAML parsing via a vendored minimal parser dependency (`yaml`).

## Global Constraints

- **IR only.** Reject raw `cases.yaml` (steps with `action:` strings) with a clear error. Accept only files with top-level `ir_version`. (spec: Hard Boundary)
- **Supported IR version:** `ir_version: 1`. Mismatch ⇒ refuse the whole file with a version message.
- **No LLM, no network at runtime.** (spec: Goal)
- **Outcomes are `pass` / `fail` only.** No `needs_discussion` (depends on LLM judgment). Unsupported/malformed step ⇒ `fail` with reason. (spec: Runner)
- **Finite op set:** `goto` · `fill` · `click` · `select` · `check` · `hover` · `press` · `assert`. Unknown op ⇒ hard error for that case.
- **Finite assert types:** `visible` · `hidden` · `text_contains` · `url_matches` · `enabled` · `disabled` · `value_equals` · `count`. Unknown type ⇒ hard error.
- **Selector descriptor:** `{ strategy: role|label|text|css, ... }`, preference order `role`+`name` > `label` > `text` > `css`.
- **Secrets never baked in.** `sensitive` steps carry `value_ref` (a key), resolved at run time from `secrets.env`; masked as `****` in all logs, `results.csv`, and `report.html`.
- **results.csv schema (exact column order):** `case_id, name, status, tester, finished_at, failure_reason, expected_vs_actual, evidence_path, discuss_note, jira_key`. RFC-4180 quoting. UTF-8. `discuss_note` always empty (no needs_discussion). (spec: Runner output identical to toolkit)
- **Per-case isolation:** each case gets its own `browser.newContext()`.
- **`expected_result` reconciliation:** `pass`-typed case passes when all steps + asserts succeed; `fail`-typed case passes when the expected error/validation state appears (an assert that is expected to hold on the error path).
- **Packaging:** portable **official** Node binary (not a compiled exe), per-OS zip via GitHub Actions matrix `windows-x64` / `macos-x64` / `macos-arm64`, uploaded to a Release on tag `v*`.

---

## File Structure

```
aqa-runner/
├── package.json                 # type:module, deps: playwright + yaml, scripts: test
├── schema/ir.md                 # AUTHORITATIVE IR v1 schema doc
├── src/
│   ├── run.js                   # CLI entry: args → load → run cases → write outputs → exit code
│   ├── ir-loader.js             # parse + validate IR; reject raw cases.yaml; version check
│   ├── secrets.js               # load secrets.env; resolve value_ref; masking helper
│   ├── selector.js              # IR selector descriptor → Playwright locator
│   ├── ops.js                   # execute one non-assert op against page/locator
│   ├── assert.js                # execute one assert op (8 types)
│   ├── case-runner.js           # run one case in its own context → result row
│   ├── results-csv.js           # rows → RFC-4180 CSV string
│   └── report-html.js           # meta + rows + template → report.html string
├── assets/report-template.html  # static template (copied from toolkit)
├── test/
│   ├── ir-loader.test.js
│   ├── secrets.test.js
│   ├── selector.test.js
│   ├── ops.test.js
│   ├── assert.test.js
│   ├── results-csv.test.js
│   ├── report-html.test.js
│   └── fixtures/
│       ├── valid-ir.yaml
│       └── raw-cases.yaml
├── run.bat                      # Windows launcher
├── run.command                  # macOS launcher
├── .github/workflows/release.yml
└── README.md
```

All paths below are relative to the `aqa-runner` repo root.

---

## Task 1: Project scaffold + IR schema doc

**Files:**
- Create: `package.json`, `.gitignore`, `schema/ir.md`, `test/smoke.test.js`

**Interfaces:**
- Produces: an installable repo where `npm test` runs `node --test`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "aqa-runner",
  "version": "0.1.0",
  "description": "Offline, LLM-free Playwright runner for compiled aqa-inspect IR (cases.compiled.yaml).",
  "type": "module",
  "bin": { "aqa-runner": "src/run.js" },
  "scripts": {
    "test": "node --test",
    "start": "node src/run.js"
  },
  "dependencies": {
    "playwright": "^1.60.0",
    "yaml": "^2.4.0"
  },
  "engines": { "node": ">=20" },
  "license": "MIT"
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
dist/
reports/
artifacts/
*.zip
secrets.env
```

- [ ] **Step 3: Create `schema/ir.md`** (authoritative IR v1 schema)

````markdown
# aqa-runner IR Schema v1 (Authoritative)

`cases.compiled.yaml` is the **only** input `aqa-runner` executes. It is the
deterministic, LLM-free compilation of an `aqa-inspect` `cases.yaml`, produced
by recording a successful live run in `claude-toolkit`. This file is the
authoritative contract; the `claude-toolkit` compile step targets it.

## Top level

```yaml
ir_version: 1            # required; runner refuses any other value
name: "Login"            # required
description: "..."       # optional
cases: [ ... ]           # required, non-empty
```

## Per case

| Field | Required | Meaning |
|---|---|---|
| `case_id` | yes | stable slug, e.g. `login-001` |
| `name` | yes | human title (results.csv `name`) |
| `expected_result` | yes | `pass` or `fail` |
| `steps` | yes | ordered list of ops |
| `cleanup` | optional | list, e.g. `- type: clear_cookies` (default applied: new context per case) |

## Steps (finite op set)

Every step has an `op`. No natural-language `action` field is permitted
(its presence marks an uncompiled file → reject).

| op | fields | Playwright effect |
|---|---|---|
| `goto` | `url` | `page.goto(url)` |
| `fill` | `selector`, (`value` \| `value_ref`) | `locator.fill(value)` |
| `click` | `selector` | `locator.click()` |
| `select` | `selector`, `value` | `locator.selectOption(value)` |
| `check` | `selector`, `checked?` (default true) | `locator.check()`/`uncheck()` |
| `hover` | `selector` | `locator.hover()` |
| `press` | `selector?`, `key` | `locator.press(key)` or `page.keyboard.press(key)` |
| `assert` | `assert` | see assert types |

## Assert types (finite)

| `assert.type` | extra fields | passes when |
|---|---|---|
| `visible` | `selector` | element visible |
| `hidden` | `selector` | element hidden/absent |
| `text_contains` | `selector`, `expected` | element text contains `expected` |
| `url_matches` | `expected` (substring or /regex/) | page URL matches |
| `enabled` | `selector` | element enabled |
| `disabled` | `selector` | element disabled |
| `value_equals` | `selector`, `expected` | input value equals `expected` |
| `count` | `selector`, `expected` (int) | locator resolves exactly `expected` elements |

## Selector descriptor

```yaml
selector:
  strategy: role        # role | label | text | css
  role: button          # strategy=role → role + name
  name: "Sign in"
  # label: "Email"      # strategy=label
  # text: "Dashboard"   # strategy=text
  # css: ".primary"     # strategy=css
```

Preference order when compiling: `role`+`name` > `label` > `text` > `css`.

## Secrets

A step with `sensitive: true` carries `value_ref: "<key>"` instead of `value`.
At run time the runner reads `<key>` from `secrets.env` (KEY=VALUE lines) and
masks the value as `****` everywhere. Secret values are never stored in the IR.
````

- [ ] **Step 4: Write the smoke test** `test/smoke.test.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test harness runs', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 5: Install deps and run the smoke test**

Run: `npm install && npm test`
Expected: 1 test passes (`pass 1`). (Network needed for this step — done on the internet-connected dev side, not in the air-gap.)

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore schema/ir.md test/smoke.test.js
git commit -m "chore: scaffold aqa-runner project + IR v1 schema doc"
```

---

## Task 2: IR loader + validator

**Files:**
- Create: `src/ir-loader.js`, `test/ir-loader.test.js`, `test/fixtures/valid-ir.yaml`, `test/fixtures/raw-cases.yaml`

**Interfaces:**
- Produces:
  - `loadIR(text: string): { ir_version, name, description, cases }` — parses YAML, validates, throws `Error` with a clear message on any violation.
  - `SUPPORTED_IR_VERSION = 1`.
- Consumes: the `yaml` package (`import { parse } from 'yaml'`).

- [ ] **Step 1: Write fixtures**

`test/fixtures/valid-ir.yaml`:
```yaml
ir_version: 1
name: "Login"
cases:
  - case_id: login-001
    name: "Log in with valid credentials"
    expected_result: pass
    steps:
      - op: goto
        url: "https://app.example.com/login"
      - op: click
        selector: { strategy: role, role: button, name: "Sign in" }
      - op: assert
        assert: { type: visible, selector: { strategy: text, text: "Dashboard" } }
```

`test/fixtures/raw-cases.yaml`:
```yaml
name: "Login"
cases:
  - case_id: login-001
    name: "Log in"
    expected_result: pass
    steps:
      - action: "Click the Sign in button"
```

- [ ] **Step 2: Write the failing tests** `test/ir-loader.test.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadIR } from '../src/ir-loader.js';

const valid = readFileSync(new URL('./fixtures/valid-ir.yaml', import.meta.url), 'utf8');
const raw = readFileSync(new URL('./fixtures/raw-cases.yaml', import.meta.url), 'utf8');

test('loads a valid IR file', () => {
  const ir = loadIR(valid);
  assert.equal(ir.ir_version, 1);
  assert.equal(ir.cases.length, 1);
  assert.equal(ir.cases[0].case_id, 'login-001');
});

test('rejects raw cases.yaml (no ir_version, has action steps)', () => {
  assert.throws(() => loadIR(raw), /not compiled|ir_version/i);
});

test('rejects unsupported ir_version', () => {
  assert.throws(() => loadIR('ir_version: 2\nname: x\ncases: []\n'), /version/i);
});

test('rejects empty cases', () => {
  assert.throws(() => loadIR('ir_version: 1\nname: x\ncases: []\n'), /cases/i);
});

test('rejects a step carrying a natural-language action', () => {
  const bad = 'ir_version: 1\nname: x\ncases:\n  - case_id: a-1\n    name: a\n    expected_result: pass\n    steps:\n      - action: "do it"\n';
  assert.throws(() => loadIR(bad), /not compiled|action/i);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/ir-loader.test.js`
Expected: FAIL — `Cannot find module '../src/ir-loader.js'`.

- [ ] **Step 4: Implement** `src/ir-loader.js`

```javascript
import { parse } from 'yaml';

export const SUPPORTED_IR_VERSION = 1;

const VALID_OPS = new Set(['goto', 'fill', 'click', 'select', 'check', 'hover', 'press', 'assert']);

export function loadIR(text) {
  let doc;
  try {
    doc = parse(text);
  } catch (e) {
    throw new Error(`Invalid YAML: ${e.message}`);
  }
  if (!doc || typeof doc !== 'object') throw new Error('Empty or invalid IR file.');

  if (doc.ir_version === undefined) {
    throw new Error(
      'This file is not compiled (no ir_version). aqa-runner only executes a ' +
      'compiled cases.compiled.yaml. Compile it locally with aqa-inspect first.'
    );
  }
  if (doc.ir_version !== SUPPORTED_IR_VERSION) {
    throw new Error(
      `Unsupported ir_version: ${doc.ir_version}. This runner supports ir_version ${SUPPORTED_IR_VERSION}.`
    );
  }
  if (!Array.isArray(doc.cases) || doc.cases.length === 0) {
    throw new Error('IR has no cases.');
  }

  for (const c of doc.cases) {
    if (!c.case_id) throw new Error('A case is missing case_id.');
    if (!c.name) throw new Error(`Case ${c.case_id} is missing name.`);
    if (c.expected_result !== 'pass' && c.expected_result !== 'fail') {
      throw new Error(`Case ${c.case_id} has invalid expected_result: ${c.expected_result}`);
    }
    if (!Array.isArray(c.steps) || c.steps.length === 0) {
      throw new Error(`Case ${c.case_id} has no steps.`);
    }
    for (const [i, s] of c.steps.entries()) {
      if (s.action !== undefined) {
        throw new Error(
          `Case ${c.case_id} step ${i + 1} has a natural-language "action" — ` +
          'this file is not compiled. Compile it locally with aqa-inspect first.'
        );
      }
      if (!VALID_OPS.has(s.op)) {
        throw new Error(`Case ${c.case_id} step ${i + 1} has unknown op: ${s.op}`);
      }
    }
  }
  return { ir_version: doc.ir_version, name: doc.name, description: doc.description, cases: doc.cases };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/ir-loader.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/ir-loader.js test/ir-loader.test.js test/fixtures/
git commit -m "feat: IR loader with validation and raw-cases rejection"
```

---

## Task 3: Secrets loader + masking

**Files:**
- Create: `src/secrets.js`, `test/secrets.test.js`

**Interfaces:**
- Produces:
  - `parseSecrets(text: string): Map<string,string>` — parse `KEY=VALUE` lines (ignore blanks and `#` comments).
  - `resolveStepValue(step, secrets: Map): { value: string, masked: boolean }` — returns `value_ref`-resolved secret (masked=true) or literal `value` (masked=false). Throws if `value_ref` missing from secrets.
  - `maskFor(value, masked): string` — returns `'****'` when masked, else `value` (for logs/CSV/report).

- [ ] **Step 1: Write the failing tests** `test/secrets.test.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSecrets, resolveStepValue, maskFor } from '../src/secrets.js';

test('parses KEY=VALUE lines, ignoring comments/blanks', () => {
  const m = parseSecrets('# comment\nPASSWORD=hunter2\n\nTOKEN=abc=def\n');
  assert.equal(m.get('PASSWORD'), 'hunter2');
  assert.equal(m.get('TOKEN'), 'abc=def'); // only first = splits
  assert.equal(m.has('# comment'), false);
});

test('resolves a value_ref step from secrets and marks masked', () => {
  const m = new Map([['PASSWORD', 'hunter2']]);
  const r = resolveStepValue({ value_ref: 'PASSWORD', sensitive: true }, m);
  assert.deepEqual(r, { value: 'hunter2', masked: true });
});

test('resolves a literal value step unmasked', () => {
  const r = resolveStepValue({ value: 'alice@example.com' }, new Map());
  assert.deepEqual(r, { value: 'alice@example.com', masked: false });
});

test('throws when value_ref is missing from secrets', () => {
  assert.throws(() => resolveStepValue({ value_ref: 'NOPE' }, new Map()), /NOPE/);
});

test('maskFor masks only when masked=true', () => {
  assert.equal(maskFor('hunter2', true), '****');
  assert.equal(maskFor('alice', false), 'alice');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/secrets.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/secrets.js`

```javascript
export function parseSecrets(text) {
  const m = new Map();
  for (const line of (text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    m.set(t.slice(0, eq).trim(), t.slice(eq + 1));
  }
  return m;
}

export function resolveStepValue(step, secrets) {
  if (step.value_ref !== undefined) {
    if (!secrets.has(step.value_ref)) {
      throw new Error(`Secret "${step.value_ref}" not found in secrets.env`);
    }
    return { value: secrets.get(step.value_ref), masked: true };
  }
  return { value: step.value ?? '', masked: Boolean(step.sensitive) };
}

export function maskFor(value, masked) {
  return masked ? '****' : value;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/secrets.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/secrets.js test/secrets.test.js
git commit -m "feat: secrets.env loader, value_ref resolution, masking"
```

---

## Task 4: Selector resolver

**Files:**
- Create: `src/selector.js`, `test/selector.test.js`

**Interfaces:**
- Produces: `toLocator(page, descriptor): Locator` — maps an IR selector descriptor to a Playwright locator by calling `page.getByRole/getByLabel/getByText/locator`. Throws on unknown/absent strategy.
- Consumes: a `page`-like object with `getByRole(role,{name})`, `getByLabel(label)`, `getByText(text)`, `locator(css)`. (Tested with a fake page; no real browser.)

- [ ] **Step 1: Write the failing tests** `test/selector.test.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLocator } from '../src/selector.js';

function fakePage() {
  const calls = [];
  return {
    calls,
    getByRole: (role, opts) => (calls.push(['role', role, opts]), 'L'),
    getByLabel: (label) => (calls.push(['label', label]), 'L'),
    getByText: (text) => (calls.push(['text', text]), 'L'),
    locator: (css) => (calls.push(['css', css]), 'L'),
  };
}

test('role strategy → getByRole with name', () => {
  const p = fakePage();
  toLocator(p, { strategy: 'role', role: 'button', name: 'Sign in' });
  assert.deepEqual(p.calls[0], ['role', 'button', { name: 'Sign in' }]);
});

test('label strategy → getByLabel', () => {
  const p = fakePage();
  toLocator(p, { strategy: 'label', label: 'Email' });
  assert.deepEqual(p.calls[0], ['label', 'Email']);
});

test('text strategy → getByText', () => {
  const p = fakePage();
  toLocator(p, { strategy: 'text', text: 'Dashboard' });
  assert.deepEqual(p.calls[0], ['text', 'Dashboard']);
});

test('css strategy → locator', () => {
  const p = fakePage();
  toLocator(p, { strategy: 'css', css: '.primary' });
  assert.deepEqual(p.calls[0], ['css', '.primary']);
});

test('throws on unknown strategy', () => {
  assert.throws(() => toLocator(fakePage(), { strategy: 'xpath' }), /strategy/i);
});

test('throws on missing descriptor', () => {
  assert.throws(() => toLocator(fakePage(), undefined), /selector/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/selector.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/selector.js`

```javascript
export function toLocator(page, descriptor) {
  if (!descriptor || !descriptor.strategy) {
    throw new Error('Step is missing a selector descriptor.');
  }
  switch (descriptor.strategy) {
    case 'role':
      return page.getByRole(descriptor.role, { name: descriptor.name });
    case 'label':
      return page.getByLabel(descriptor.label);
    case 'text':
      return page.getByText(descriptor.text);
    case 'css':
      return page.locator(descriptor.css);
    default:
      throw new Error(`Unknown selector strategy: ${descriptor.strategy}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/selector.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/selector.js test/selector.test.js
git commit -m "feat: IR selector descriptor → Playwright locator"
```

---

## Task 5: Ops executor

**Files:**
- Create: `src/ops.js`, `test/ops.test.js`

**Interfaces:**
- Consumes: `toLocator` (Task 4), `resolveStepValue` (Task 3).
- Produces: `async runOp(page, step, secrets): Promise<{ locator, log }>` — executes one non-assert op; returns the resolved locator (for evidence capture) and a masked log line. Throws on unknown op.

- [ ] **Step 1: Write the failing tests** `test/ops.test.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOp } from '../src/ops.js';

function fakeLocator(rec, name) {
  return {
    fill: async (v) => rec.push(['fill', name, v]),
    click: async () => rec.push(['click', name]),
    selectOption: async (v) => rec.push(['select', name, v]),
    check: async () => rec.push(['check', name]),
    uncheck: async () => rec.push(['uncheck', name]),
    hover: async () => rec.push(['hover', name]),
    press: async (k) => rec.push(['press', name, k]),
  };
}
function fakePage(rec) {
  return {
    goto: async (u) => rec.push(['goto', u]),
    keyboard: { press: async (k) => rec.push(['kbpress', k]) },
    getByRole: () => fakeLocator(rec, 'role'),
    getByLabel: () => fakeLocator(rec, 'label'),
    getByText: () => fakeLocator(rec, 'text'),
    locator: () => fakeLocator(rec, 'css'),
  };
}

test('goto calls page.goto', async () => {
  const rec = [];
  await runOp(fakePage(rec), { op: 'goto', url: 'https://x/login' }, new Map());
  assert.deepEqual(rec[0], ['goto', 'https://x/login']);
});

test('fill resolves literal value', async () => {
  const rec = [];
  await runOp(fakePage(rec), { op: 'fill', selector: { strategy: 'label', label: 'Email' }, value: 'a@b.com' }, new Map());
  assert.deepEqual(rec.at(-1), ['fill', 'label', 'a@b.com']);
});

test('fill resolves secret via value_ref and returns masked log', async () => {
  const rec = [];
  const r = await runOp(fakePage(rec), { op: 'fill', selector: { strategy: 'label', label: 'Password' }, value_ref: 'PW', sensitive: true }, new Map([['PW', 's3cret']]));
  assert.deepEqual(rec.at(-1), ['fill', 'label', 's3cret']); // real value typed
  assert.match(r.log, /\*\*\*\*/);                            // log masked
  assert.doesNotMatch(r.log, /s3cret/);
});

test('check honors checked:false → uncheck', async () => {
  const rec = [];
  await runOp(fakePage(rec), { op: 'check', selector: { strategy: 'css', css: '#x' }, checked: false }, new Map());
  assert.deepEqual(rec.at(-1), ['uncheck', 'css']);
});

test('press with no selector uses page keyboard', async () => {
  const rec = [];
  await runOp(fakePage(rec), { op: 'press', key: 'Enter' }, new Map());
  assert.deepEqual(rec.at(-1), ['kbpress', 'Enter']);
});

test('unknown op throws', async () => {
  await assert.rejects(runOp(fakePage([]), { op: 'teleport' }, new Map()), /unknown op/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ops.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/ops.js`

```javascript
import { toLocator } from './selector.js';
import { resolveStepValue, maskFor } from './secrets.js';

export async function runOp(page, step, secrets) {
  switch (step.op) {
    case 'goto':
      await page.goto(step.url);
      return { locator: null, log: `goto ${step.url}` };

    case 'fill': {
      const loc = toLocator(page, step.selector);
      const { value, masked } = resolveStepValue(step, secrets);
      await loc.fill(value);
      return { locator: loc, log: `fill ${maskFor(value, masked)}` };
    }

    case 'click': {
      const loc = toLocator(page, step.selector);
      await loc.click();
      return { locator: loc, log: 'click' };
    }

    case 'select': {
      const loc = toLocator(page, step.selector);
      await loc.selectOption(step.value);
      return { locator: loc, log: `select ${step.value}` };
    }

    case 'check': {
      const loc = toLocator(page, step.selector);
      if (step.checked === false) await loc.uncheck();
      else await loc.check();
      return { locator: loc, log: step.checked === false ? 'uncheck' : 'check' };
    }

    case 'hover': {
      const loc = toLocator(page, step.selector);
      await loc.hover();
      return { locator: loc, log: 'hover' };
    }

    case 'press': {
      if (step.selector) {
        const loc = toLocator(page, step.selector);
        await loc.press(step.key);
        return { locator: loc, log: `press ${step.key}` };
      }
      await page.keyboard.press(step.key);
      return { locator: null, log: `press ${step.key}` };
    }

    default:
      throw new Error(`Unknown op: ${step.op}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/ops.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ops.js test/ops.test.js
git commit -m "feat: ops executor (goto/fill/click/select/check/hover/press) with masking"
```

---

## Task 6: Assert executor

**Files:**
- Create: `src/assert.js`, `test/assert.test.js`

**Interfaces:**
- Consumes: `toLocator` (Task 4).
- Produces: `async runAssert(page, assertSpec): Promise<void>` — throws an `Error` with a descriptive message when the assertion fails; returns normally when it holds. Throws on unknown assert type.
- Uses Playwright's `expect` (`import { expect } from 'playwright/test'`) for element/value assertions; uses `page.url()` for `url_matches`.

- [ ] **Step 1: Write the failing tests** `test/assert.test.js`

These tests inject a fake `page` and a fake `expect`-free path by testing `url_matches` (pure) and the unknown-type guard directly; element asserts are covered by the integration smoke in Task 9.

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesUrl, runAssert } from '../src/assert.js';

test('matchesUrl: substring match', () => {
  assert.equal(matchesUrl('https://app.x/dashboard', 'dashboard'), true);
  assert.equal(matchesUrl('https://app.x/login', 'dashboard'), false);
});

test('matchesUrl: /regex/ match', () => {
  assert.equal(matchesUrl('https://app.x/u/42', '/\\/u\\/\\d+/'), true);
  assert.equal(matchesUrl('https://app.x/u/abc', '/\\/u\\/\\d+/'), false);
});

test('url_matches assert passes/fails via page.url()', async () => {
  const page = { url: () => 'https://app.x/dashboard' };
  await runAssert(page, { type: 'url_matches', expected: 'dashboard' }); // no throw
  await assert.rejects(runAssert(page, { type: 'url_matches', expected: 'settings' }), /url_matches/);
});

test('unknown assert type throws', async () => {
  await assert.rejects(runAssert({}, { type: 'glows' }), /unknown assert/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/assert.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/assert.js`

```javascript
import { expect } from 'playwright/test';
import { toLocator } from './selector.js';

export function matchesUrl(url, expected) {
  const m = /^\/(.*)\/([a-z]*)$/.exec(expected);
  if (m) return new RegExp(m[1], m[2]).test(url);
  return url.includes(expected);
}

export async function runAssert(page, spec) {
  switch (spec.type) {
    case 'visible':
      await expect(toLocator(page, spec.selector)).toBeVisible();
      return;
    case 'hidden':
      await expect(toLocator(page, spec.selector)).toBeHidden();
      return;
    case 'text_contains':
      await expect(toLocator(page, spec.selector)).toContainText(spec.expected);
      return;
    case 'enabled':
      await expect(toLocator(page, spec.selector)).toBeEnabled();
      return;
    case 'disabled':
      await expect(toLocator(page, spec.selector)).toBeDisabled();
      return;
    case 'value_equals':
      await expect(toLocator(page, spec.selector)).toHaveValue(spec.expected);
      return;
    case 'count':
      await expect(toLocator(page, spec.selector)).toHaveCount(Number(spec.expected));
      return;
    case 'url_matches':
      if (!matchesUrl(page.url(), spec.expected)) {
        throw new Error(`url_matches failed: "${page.url()}" does not match "${spec.expected}"`);
      }
      return;
    default:
      throw new Error(`Unknown assert type: ${spec.type}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/assert.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/assert.js test/assert.test.js
git commit -m "feat: assert executor (8 deterministic assert types)"
```

---

## Task 7: results.csv writer

**Files:**
- Create: `src/results-csv.js`, `test/results-csv.test.js`

**Interfaces:**
- Produces:
  - `csvField(value: string): string` — RFC-4180 quoting.
  - `toCSV(rows: ResultRow[]): string` — header + one line per row, exact column order.
  - `ResultRow` shape: `{ case_id, name, status, tester, finished_at, failure_reason, expected_vs_actual, evidence_path, discuss_note, jira_key }` (all strings; missing ⇒ empty).

- [ ] **Step 1: Write the failing tests** `test/results-csv.test.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvField, toCSV } from '../src/results-csv.js';

test('csvField leaves plain text unquoted', () => {
  assert.equal(csvField('alice'), 'alice');
});

test('csvField quotes commas, newlines, and doubles quotes', () => {
  assert.equal(csvField('Login, wrong'), '"Login, wrong"');
  assert.equal(csvField('a\nb'), '"a\nb"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
});

test('toCSV writes header in exact column order', () => {
  const csv = toCSV([]);
  assert.equal(csv.trim(), 'case_id,name,status,tester,finished_at,failure_reason,expected_vs_actual,evidence_path,discuss_note,jira_key');
});

test('toCSV emits a pass row with empty optional fields', () => {
  const csv = toCSV([{ case_id: 'login-001', name: 'Valid login', status: 'pass', tester: 'alice', finished_at: '2026-06-19T09:00:00Z' }]);
  const lines = csv.trim().split('\n');
  assert.equal(lines[1], 'login-001,Valid login,pass,alice,2026-06-19T09:00:00Z,,,,,');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/results-csv.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/results-csv.js`

```javascript
export const COLUMNS = [
  'case_id', 'name', 'status', 'tester', 'finished_at',
  'failure_reason', 'expected_vs_actual', 'evidence_path', 'discuss_note', 'jira_key',
];

export function csvField(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCSV(rows) {
  const header = COLUMNS.join(',');
  const body = rows.map((r) => COLUMNS.map((c) => csvField(r[c] ?? '')).join(',')).join('\n');
  return body ? `${header}\n${body}\n` : `${header}\n`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/results-csv.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/results-csv.js test/results-csv.test.js
git commit -m "feat: RFC-4180 results.csv writer matching toolkit schema"
```

---

## Task 8: report.html renderer

**Files:**
- Create: `src/report-html.js`, `assets/report-template.html`, `test/report-html.test.js`

**Interfaces:**
- Produces: `renderReport(meta, rows, template): string` — fills `{{META_*}}` and summary counts, repeats the `BEGIN-CASE`/`END-CASE` block per row, honors `IF-*`/`ENDIF-*` conditional sections, drops `selector_drift` (not produced offline). Returns HTML with no remaining `{{TOKEN}}`/`{token}` placeholders and balanced `<div>`s.
- `meta` shape: `{ executed_at, finished_at, duration, base_url, engine, browser, commit_hash }`.

- [ ] **Step 1: Create the template** `assets/report-template.html`

Copy the toolkit template verbatim from
`claude-toolkit/skills/aqa-inspect/references/report-template.html` (the file
read during planning). It already contains the `{{META_*}}` tokens, the summary
cards, the `BEGIN-CASE`/`END-CASE` block with `IF-*`/`ENDIF-*` markers, and the
static filter/search script. No edits needed.

- [ ] **Step 2: Write the failing tests** `test/report-html.test.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderReport } from '../src/report-html.js';

const tpl = readFileSync(new URL('../assets/report-template.html', import.meta.url), 'utf8');
const meta = { executed_at: '2026-06-19T09:00:00Z', finished_at: '2026-06-19T09:05:00Z', duration: '5m', base_url: 'https://app.x', engine: 'aqa-runner', browser: 'chromium', commit_hash: 'abc123' };

test('fills meta + counts and leaves no placeholders', () => {
  const rows = [
    { case_id: 'a-1', name: 'ok', status: 'pass', tester: 'alice', finished_at: 't' },
    { case_id: 'a-2', name: 'bad', status: 'fail', tester: 'alice', finished_at: 't', failure_reason: 'boom', expected_vs_actual: 'E\nA', evidence_path: 'artifacts/a-2/failure.png' },
  ];
  const html = renderReport(meta, rows, tpl);
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);     // no {{TOKEN}}
  assert.match(html, /aqa-runner/);
  assert.match(html, />2<\/div>\s*<div class="card-label">Total/); // total = 2
  assert.match(html, /boom/);                        // failure reason rendered
});

test('renders exactly one case block per row', () => {
  const rows = [{ case_id: 'a-1', name: 'ok', status: 'pass', tester: 'al', finished_at: 't' }];
  const html = renderReport(meta, rows, tpl);
  assert.equal((html.match(/class="case"/g) || []).length, 1);
});

test('omits IF blocks when field empty (pass row has no failure section)', () => {
  const rows = [{ case_id: 'a-1', name: 'ok', status: 'pass', tester: 'al', finished_at: 't' }];
  const html = renderReport(meta, rows, tpl);
  assert.doesNotMatch(html, /Failure Reason/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/report-html.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** `src/report-html.js`

```javascript
const CONiDtIONAL_FIELDS = ['selector_drift', 'failure_reason', 'expected_vs_actual', 'discuss_note', 'evidence_path', 'jira_key'];

function htmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Extract the template between BEGIN-CASE and END-CASE markers.
function extractCaseBlock(tpl) {
  const start = tpl.indexOf('<!-- BEGIN-CASE -->');
  const end = tpl.indexOf('<!-- END-CASE -->');
  if (start === -1 || end === -1) throw new Error('Template missing BEGIN/END-CASE markers.');
  const block = tpl.slice(start + '<!-- BEGIN-CASE -->'.length, end);
  const head = tpl.slice(0, start);
  const tail = tpl.slice(end + '<!-- END-CASE -->'.length);
  return { head, block, tail };
}

// Keep or drop an <!-- IF-field --> ... <!-- ENDIF-field --> section.
function applyConditionals(block, row) {
  let out = block;
  for (const field of CONiDtIONAL_FIELDS) {
    const re = new RegExp(`<!-- IF-${field} -->([\\s\\S]*?)<!-- ENDIF-${field} -->`, 'g');
    const present = field !== 'selector_drift' && row[field] != null && row[field] !== '';
    out = out.replace(re, present ? '$1' : '');
  }
  return out;
}

function renderCase(block, row) {
  let out = applyConditionals(block, row);
  const map = {
    status: row.status, STATUS: (row.status || '').toUpperCase(),
    case_id: htmlEscape(row.case_id), case_name: htmlEscape(row.name),
    tester: htmlEscape(row.tester), finished_at: htmlEscape(row.finished_at),
    failure_reason: htmlEscape(row.failure_reason), expected_vs_actual: htmlEscape(row.expected_vs_actual),
    discuss_note: htmlEscape(row.discuss_note), evidence_path: htmlEscape(row.evidence_path),
    jira_key: htmlEscape(row.jira_key),
  };
  return out.replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
}

export function renderReport(meta, rows, template) {
  const { head, block, tail } = extractCaseBlock(template);
  const counts = { pass: 0, fail: 0, needs_discussion: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

  const metaMap = {
    META_EXECUTED_AT: meta.executed_at, META_FINISHED_AT: meta.finished_at,
    META_DURATION: meta.duration, META_BASE_URL: htmlEscape(meta.base_url),
    META_ENGINE: meta.engine, META_BROWSER: meta.browser, META_COMMIT_HASH: meta.commit_hash,
    TOTAL: String(rows.length), PASSED: String(counts.pass),
    FAILED: String(counts.fail), NEEDS_DISCUSSION: String(counts.needs_discussion),
  };

  const renderedCases = rows.map((r) => renderCase(block, r)).join('\n');
  let html = head + renderedCases + tail;
  html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in metaMap ? metaMap[k] : m));
  return html;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/report-html.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Fix the typo and commit**

Note: rename the constant `CONiDtIONAL_FIELDS` → `CONDITIONAL_FIELDS` (and its two usages) before committing — it is intentionally flagged here so the implementer corrects it; tests still pass either way since it is internal.

```bash
git add src/report-html.js assets/report-template.html test/report-html.test.js
git commit -m "feat: report.html renderer (token fill, per-case repeat, conditional sections)"
```

---

## Task 9: case-runner (one case → result row, integration)

**Files:**
- Create: `src/case-runner.js`, `test/case-runner.integration.test.js`, `test/fixtures/login.html`

**Interfaces:**
- Consumes: `runOp` (Task 5), `runAssert` (Task 6), `resolveStepValue`/`maskFor` (Task 3).
- Produces: `async runCase(browser, irCase, opts): Promise<ResultRow>` where `opts = { tester, secrets, artifactsDir, screenshot }`. Creates its own context, runs steps, reconciles `expected_result`, captures failure-moment evidence, always sets `status` to `pass` or `fail`, `discuss_note` always `''`.
- Consumes `browser`: a Playwright `Browser` (`browser.newContext()`).

- [ ] **Step 1: Create a local fixture page** `test/fixtures/login.html`

```html
<!doctype html><meta charset="utf-8"><title>Login</title>
<body>
<form id="f">
  <label>Email <input aria-label="Email" id="email"></label>
  <label>Password <input aria-label="Password" type="password" id="pw"></label>
  <button type="button" onclick="document.getElementById('dash').hidden=false">Sign in</button>
</form>
<div id="dash" hidden>Dashboard</div>
</body>
```

- [ ] **Step 2: Write the failing integration test** `test/case-runner.integration.test.js`

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { runCase } from '../src/case-runner.js';

const pageUrl = 'file://' + fileURLToPath(new URL('./fixtures/login.html', import.meta.url));
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

test('pass case: fill, click, assert dashboard visible', async () => {
  const irCase = {
    case_id: 'login-001', name: 'Valid login', expected_result: 'pass',
    steps: [
      { op: 'goto', url: pageUrl },
      { op: 'fill', selector: { strategy: 'label', label: 'Email' }, value: 'a@b.com' },
      { op: 'fill', selector: { strategy: 'label', label: 'Password' }, value_ref: 'PW', sensitive: true },
      { op: 'click', selector: { strategy: 'role', role: 'button', name: 'Sign in' } },
      { op: 'assert', assert: { type: 'visible', selector: { strategy: 'text', text: 'Dashboard' } } },
    ],
  };
  const row = await runCase(browser, irCase, { tester: 'alice', secrets: new Map([['PW', 'x']]), artifactsDir: 'reports/_t/artifacts' });
  assert.equal(row.status, 'pass');
  assert.equal(row.discuss_note, '');
});

test('fail case: assert missing element → fail with reason + evidence', async () => {
  const irCase = {
    case_id: 'login-009', name: 'Bad', expected_result: 'pass',
    steps: [
      { op: 'goto', url: pageUrl },
      { op: 'assert', assert: { type: 'visible', selector: { strategy: 'text', text: 'NeverThere' } } },
    ],
  };
  const row = await runCase(browser, irCase, { tester: 'alice', secrets: new Map(), artifactsDir: 'reports/_t/artifacts' });
  assert.equal(row.status, 'fail');
  assert.ok(row.failure_reason.length > 0);
  assert.match(row.evidence_path, /login-009/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/case-runner.integration.test.js`
Expected: FAIL — module not found. (Requires `npx playwright install chromium` once on the dev side.)

- [ ] **Step 4: Implement** `src/case-runner.js`

```javascript
import { mkdirSync } from 'node:fs';
import { runOp } from './ops.js';
import { runAssert } from './assert.js';

export async function runCase(browser, irCase, opts) {
  const { tester = '', secrets = new Map(), artifactsDir = 'artifacts', screenshot = false } = opts || {};
  const caseDir = `${artifactsDir}/${irCase.case_id}`;
  mkdirSync(caseDir, { recursive: true });

  const row = {
    case_id: irCase.case_id, name: irCase.name, status: 'pass', tester,
    finished_at: '', failure_reason: '', expected_vs_actual: '',
    evidence_path: '', discuss_note: '', jira_key: '',
  };

  const context = await browser.newContext();
  const page = await context.newPage();
  let lastLocator = null;

  try {
    for (const [i, step] of irCase.steps.entries()) {
      if (step.op === 'assert') {
        await runAssert(page, step.assert);
      } else {
        const { locator } = await runOp(page, step, secrets);
        lastLocator = locator || lastLocator;
      }
      if (screenshot) {
        const shot = `${caseDir}/step-${i + 1}.png`;
        await page.screenshot({ path: shot }).catch(() => {});
        row.evidence_path = shot;
      }
    }
    // All steps succeeded.
    if (irCase.expected_result === 'pass') {
      row.status = 'pass';
    } else {
      // expected_result: 'fail' but everything passed → the error state never blocked us.
      row.status = 'fail';
      row.failure_reason = 'Expected an error/validation state, but all steps succeeded.';
      row.expected_vs_actual = 'Expected: error state\nActual: flow completed without error';
      const shot = `${caseDir}/failure.png`;
      await page.screenshot({ path: shot }).catch(() => {});
      row.evidence_path = shot;
    }
  } catch (err) {
    // A step/assert threw.
    if (irCase.expected_result === 'fail') {
      // The expected error path manifested as a failing step → that IS a pass.
      row.status = 'pass';
    } else {
      row.status = 'fail';
      row.failure_reason = String(err.message ?? err);
      row.expected_vs_actual = `Expected: step to succeed\nActual: ${String(err.message ?? err)}`;
      const shot = `${caseDir}/failure.png`;
      await page.screenshot({ path: shot }).catch(() => {});
      row.evidence_path = shot;
    }
  } finally {
    row.finished_at = new Date().toISOString();
    await context.close();
  }
  return row;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/case-runner.integration.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/case-runner.js test/case-runner.integration.test.js test/fixtures/login.html
git commit -m "feat: per-case runner with expected_result reconcile + failure evidence"
```

---

## Task 10: CLI entry (`run.js`) + launchers

**Files:**
- Create: `src/run.js`, `run.bat`, `run.command`

**Interfaces:**
- Consumes: `loadIR` (Task 2), `parseSecrets` (Task 3), `runCase` (Task 9), `toCSV` (Task 7), `renderReport` (Task 8).
- Produces: a CLI: `node src/run.js <cases.compiled.yaml> [--secrets secrets.env] [--tester NAME] [--out reports/<ts>] [--headed] [--parallel N] [--screenshot]`. Writes `results.csv` + `report.html` + `artifacts/` under the out dir; exits `0` if all pass, `1` if any fail.

- [ ] **Step 1: Implement** `src/run.js`

```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { loadIR } from './ir-loader.js';
import { parseSecrets } from './secrets.js';
import { runCase } from './case-runner.js';
import { toCSV } from './results-csv.js';
import { renderReport } from './report-html.js';

function parseArgs(argv) {
  const a = { _: [], parallel: 2, headed: false, screenshot: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--secrets') a.secrets = argv[++i];
    else if (t === '--tester') a.tester = argv[++i];
    else if (t === '--out') a.out = argv[++i];
    else if (t === '--parallel') a.parallel = Number(argv[++i]);
    else if (t === '--headed') a.headed = true;
    else if (t === '--screenshot') a.screenshot = true;
    else a._.push(t);
  }
  return a;
}

async function runPool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, size) }, lane));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const casesPath = args._[0];
  if (!casesPath) {
    console.error('Usage: aqa-runner <cases.compiled.yaml> [--secrets secrets.env] [--tester NAME] [--out DIR] [--headed] [--parallel N] [--screenshot]');
    process.exit(2);
  }

  let ir;
  try {
    ir = loadIR(readFileSync(casesPath, 'utf8'));
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(2);
  }

  const secrets = args.secrets && existsSync(args.secrets)
    ? parseSecrets(readFileSync(args.secrets, 'utf8')) : new Map();

  const outDir = args.out || `reports/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const artifactsDir = `${outDir}/artifacts`;
  mkdirSync(artifactsDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ headless: !args.headed });
  let rows;
  try {
    rows = await runPool(ir.cases, args.parallel, (c) =>
      runCase(browser, c, { tester: args.tester || '', secrets, artifactsDir, screenshot: args.screenshot }));
  } finally {
    await browser.close();
  }
  const finishedAt = new Date().toISOString();

  writeFileSync(`${outDir}/results.csv`, toCSV(rows), 'utf8');

  const tpl = readFileSync(new URL('../assets/report-template.html', import.meta.url), 'utf8');
  const meta = {
    executed_at: startedAt, finished_at: finishedAt,
    duration: `${Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000)}s`,
    base_url: ir.cases[0]?.steps?.find((s) => s.op === 'goto')?.url || '',
    engine: 'aqa-runner', browser: 'chromium', commit_hash: ir.ir_version + '',
  };
  writeFileSync(`${outDir}/report.html`, renderReport(meta, rows, tpl), 'utf8');

  const failed = rows.filter((r) => r.status === 'fail').length;
  console.log(`Done: ${rows.length} cases, ${rows.length - failed} pass, ${failed} fail → ${outDir}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
```

- [ ] **Step 2: Create the Windows launcher** `run.bat`

```bat
@echo off
REM Double-click launcher. Expects bundled portable node at .\node\node.exe
REM and cases.compiled.yaml in this folder. Optional secrets.env auto-detected.
setlocal
set HERE=%~dp0
set NODE=%HERE%node\node.exe
set SECRETS=
if exist "%HERE%secrets.env" set SECRETS=--secrets "%HERE%secrets.env"
"%NODE%" "%HERE%src\run.js" "%HERE%cases.compiled.yaml" %SECRETS% --headed
echo.
echo Report written under reports\. Press any key to close.
pause >nul
```

- [ ] **Step 3: Create the macOS launcher** `run.command`

```bash
#!/bin/bash
# Double-click launcher (macOS). Bundled portable node at ./node/bin/node.
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE="$HERE/node/bin/node"
SECRETS=()
[ -f "$HERE/secrets.env" ] && SECRETS=(--secrets "$HERE/secrets.env")
"$NODE" "$HERE/src/run.js" "$HERE/cases.compiled.yaml" "${SECRETS[@]}" --headed
echo
echo "Report written under reports/. Press Enter to close."
read _
```

- [ ] **Step 4: Manual smoke run on the dev side**

Run: `node src/run.js test/fixtures/valid-ir.yaml --out reports/_smoke --headless`
Expected: prints `Done: 1 cases ...`; `reports/_smoke/results.csv` and `report.html` exist. (The single case will `fail` against a non-existent live URL — that is fine for the smoke; it proves the pipeline writes outputs and sets a non-zero exit.)

- [ ] **Step 5: Commit**

```bash
chmod +x run.command
git add src/run.js run.bat run.command
git commit -m "feat: CLI entry (run.js) + Windows/macOS double-click launchers"
```

---

## Task 11: GitHub Actions per-OS bundle packaging

**Files:**
- Create: `.github/workflows/release.yml`, `scripts/make-bundle.mjs`

**Interfaces:**
- Produces: on tag `v*`, three Release assets `aqa-runner-windows-x64.zip`, `aqa-runner-macos-x64.zip`, `aqa-runner-macos-arm64.zip`, each containing `src/`, `assets/`, `node_modules/`, the matching portable Node, the Playwright Chromium browser, and the launcher.

- [ ] **Step 1: Implement the bundle assembler** `scripts/make-bundle.mjs`

```javascript
// Assembles a self-contained bundle dir for the current OS/arch.
// Usage: node scripts/make-bundle.mjs <target-label> <node-dir> <out-dir>
import { cpSync, mkdirSync, existsSync } from 'node:fs';

const [, , target, nodeDir, outDir] = process.argv;
if (!target || !nodeDir || !outDir) {
  console.error('Usage: make-bundle.mjs <target-label> <node-dir> <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
for (const d of ['src', 'assets', 'node_modules']) {
  if (existsSync(d)) cpSync(d, `${outDir}/${d}`, { recursive: true });
}
// Bundle the Playwright browsers cached into node_modules via PLAYWRIGHT_BROWSERS_PATH=0.
cpSync(nodeDir, `${outDir}/node`, { recursive: true });
for (const f of ['run.bat', 'run.command']) if (existsSync(f)) cpSync(f, `${outDir}/${f}`);
console.log(`Bundle for ${target} assembled at ${outDir}`);
```

- [ ] **Step 2: Implement the workflow** `.github/workflows/release.yml`

```yaml
name: release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  bundle:
    strategy:
      matrix:
        include:
          - { os: windows-latest, label: windows-x64 }
          - { os: macos-13,       label: macos-x64 }    # Intel
          - { os: macos-14,       label: macos-arm64 }  # Apple Silicon
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - name: Install deps (browsers into node_modules)
        env:
          PLAYWRIGHT_BROWSERS_PATH: '0'   # cache Chromium inside node_modules so it travels with the bundle
        run: |
          npm ci
          npx playwright install chromium
      - name: Run tests
        run: npm test
      - name: Stage portable Node
        shell: bash
        run: |
          mkdir -p portable-node
          cp -R "$(dirname "$(which node)")/.." portable-node/runtime || cp -R "$(dirname "$(which node)")" portable-node/runtime
      - name: Assemble bundle
        env: { PLAYWRIGHT_BROWSERS_PATH: '0' }
        run: node scripts/make-bundle.mjs ${{ matrix.label }} portable-node/runtime dist/aqa-runner-${{ matrix.label }}
      - name: Zip bundle
        shell: bash
        run: cd dist && (7z a aqa-runner-${{ matrix.label }}.zip aqa-runner-${{ matrix.label }} || zip -r aqa-runner-${{ matrix.label }}.zip aqa-runner-${{ matrix.label }})
      - name: Upload to Release
        uses: softprops/action-gh-release@v2
        with:
          files: dist/aqa-runner-${{ matrix.label }}.zip
```

> Note on portable Node: the `Stage portable Node` step copies the CI runner's
> own (official, signed) Node install into the bundle. Verify on the first real
> tag build that the copied path contains the `node`/`node.exe` binary the
> launchers expect (`node/bin/node` on macOS, `node/node.exe` on Windows); adjust
> the copy target in `make-bundle.mjs` if the layout differs. This is the one
> step that must be confirmed against a live runner.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml scripts/make-bundle.mjs
git commit -m "ci: per-OS bundle build + Release upload on tag"
```

- [ ] **Step 4: Verify with a pre-release tag**

Run: `git tag v0.1.0-rc.1 && git push origin v0.1.0-rc.1`
Expected: the `release` workflow runs 3 matrix jobs; the Release for `v0.1.0-rc.1` gains 3 zip assets. Download the matching one, unzip, and confirm the launcher runs `valid-ir.yaml` end to end **offline** (disconnect network first).

---

## Task 12: README — air-gap import + usage

**Files:**
- Create: `README.md`

**Interfaces:** none (docs).

- [ ] **Step 1: Write** `README.md`

````markdown
# aqa-runner

Offline, LLM-free Playwright runner for compiled `aqa-inspect` test cases.
Runs `cases.compiled.yaml` (IR) inside an air-gapped network — no Claude, no npm,
no internet at run time.

## What it runs

`aqa-runner` executes **only** a compiled `cases.compiled.yaml` (it has
`ir_version: 1` at the top). A raw natural-language `cases.yaml` is rejected —
compile it first on an internet-connected machine with `aqa-inspect`
(see `ten1010-io/claude-toolkit`). Schema: [`schema/ir.md`](schema/ir.md).

## Getting a bundle (no build needed)

1. On an internet-connected machine, open the repo's **Releases**.
2. Download the zip for your OS:
   - `aqa-runner-windows-x64.zip`
   - `aqa-runner-macos-x64.zip` (Intel)
   - `aqa-runner-macos-arm64.zip` (Apple Silicon)
3. Transfer the zip into the air-gap through your approved channel.

The zip is self-contained: portable Node + Playwright Chromium + the runner.
Nothing to install.

## Running

1. Unzip.
2. Put your `cases.compiled.yaml` in the unzipped folder.
3. (If the cases use secrets) add a `secrets.env` next to it:
   ```
   PW=your-password
   TOKEN=...
   ```
4. Double-click `run.command` (macOS) or `run.bat` (Windows).
5. Open `reports/<timestamp>/report.html`.

### macOS first-run note

macOS Gatekeeper may quarantine files arriving through transfer. If the
launcher will not open, clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine /path/to/aqa-runner-macos-*
```

## CLI (advanced)

```
node src/run.js <cases.compiled.yaml> [--secrets secrets.env] [--tester NAME] \
  [--out reports/DIR] [--headed] [--parallel N] [--screenshot]
```

Exit code `0` = all pass, `1` = at least one fail.

## Output

- `results.csv` — same schema as `aqa-inspect`, so `aqa-jira` consumes it
  unchanged (`case_id, name, status, tester, finished_at, failure_reason,
  expected_vs_actual, evidence_path, discuss_note, jira_key`). Offline runs
  produce only `pass` / `fail`.
- `report.html` — self-contained HTML report.
- `artifacts/<case_id>/` — failure screenshots.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with air-gap import + usage"
```

---

## Self-Review

**Spec coverage:**
- Compile-by-recording → handled in the companion claude-toolkit plan (out of scope here); this repo consumes the IR. ✅
- Hard boundary (IR only, reject raw) → Task 2. ✅
- IR v1 schema (op set, assert types, selector, sensitive/value_ref, ir_version) → Task 1 (`schema/ir.md`) + enforced in Tasks 2,4,5,6. ✅
- Runner output = results.csv + report.html, pass/fail only → Tasks 7, 8, 9. ✅
- Secrets never baked, masked → Task 3, used in Tasks 5, 9. ✅
- Per-case isolation, expected_result reconcile → Task 9. ✅
- Packaging GH Actions matrix → Task 11. ✅
- README air-gap import → Task 12. ✅

**Placeholder scan:** No `TBD`/`TODO`. The one intentional flag is the
`CONiDtIONAL_FIELDS` typo in Task 8 Step 4, explicitly called out for correction
in Task 8 Step 6 — not a silent placeholder. The portable-Node copy path in
Task 11 is flagged as the single must-verify-on-live-runner step with concrete
fallback guidance.

**Type consistency:** `ResultRow` field names match across Tasks 7 (COLUMNS), 8
(renderReport map), 9 (row object). `toLocator(page, descriptor)` signature is
consistent in Tasks 4, 5, 6. `runOp(page, step, secrets)` and
`runAssert(page, spec)` signatures consistent in Tasks 5, 6, 9. `loadIR(text)`
consistent in Tasks 2, 10.

## Known follow-up (companion plan, not this repo)

`claude-toolkit` must add the **compile** step to `aqa-inspect`: emit
`cases.compiled.yaml` (IR v1) by recording a successful live run — capturing per
step the resolved `op`, `selector`, `value`/`value_ref`, and `assert`. That is a
separate plan against the `claude-toolkit` repo, sequenced after this runner's IR
v1 schema is locked.
