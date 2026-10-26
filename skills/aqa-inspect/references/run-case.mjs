#!/usr/bin/env node
// run-case.mjs — the shipped Playwright driver + orchestrator for aqa-inspect
// (engine-playwright.md). Copy this file (with compile.mjs) into the report
// dir and run it there. Do NOT hand-write a per-run driver — regenerating this
// logic per run is how IR bugs (strict-mode selectors, unsettled redirects)
// creep in.
//
//   node run-case.mjs [--cases ../../cases.yaml] [--parallel 2] [--tester name]
//                     [--headless] [--screenshot] [--only id1,id2]
//
// Requires `playwright` and `yaml` to be resolvable from the working dir
// (npm i playwright yaml). Executes op-annotated cases (see cases-yaml.md
// "Machine op fields"), writes results.csv (RFC 4180), failure-moment
// screenshots into artifacts/{case_id}/, summary.json, and rebuilds
// cases.compiled.yaml (IR v2) from the union of all passing cases.
//
// Target-specific values (login path, form selectors, button text) come ONLY
// from the cases file's `login:` block — nothing app-specific lives here.
import { chromium } from 'playwright';
import { parse, stringify } from 'yaml';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loginConfig, substitute, compileIRCases } from './compile.mjs';

// ---- CLI ----
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const CASES_PATH = opt('--cases', 'cases.yaml');
const PARALLEL = Math.max(1, parseInt(opt('--parallel', '2'), 10) || 2);
const TESTER = opt('--tester', '');
const HEADED = !flag('--headless');
const FULL_SHOT = flag('--screenshot');
const ONLY = (opt('--only', process.env.ONLY || '') || '').split(',').filter(Boolean);
const STEP_TIMEOUT = parseInt(process.env.AQA_STEP_TIMEOUT || '15000', 10);

const doc = parse(readFileSync(CASES_PATH, 'utf8'));
const LOGIN = loginConfig(doc);
const CASES = ONLY.length ? doc.cases.filter((c) => ONLY.includes(c.case_id)) : doc.cases;

// ---- step execution ----
class ManualSkip extends Error { constructor(note) { super(note); this.manual = true; this.note = note; } }

function locator(page, selector, td) {
  if (!selector) throw new Error(`Step is missing a selector: cannot resolve`);
  const s = selector;
  if (s.strategy === 'css') return page.locator(substitute(s.css, td));
  if (s.strategy === 'role') return page.getByRole(s.role, s.name ? { name: substitute(s.name, td) } : undefined);
  if (s.strategy === 'label') return page.getByLabel(substitute(s.label, td));
  if (s.strategy === 'text') return page.getByText(substitute(s.text, td));
  throw new Error(`Unknown selector strategy: ${s.strategy}`);
}

async function assertBodyText(page, expected, present) {
  await page.waitForFunction(
    ([t, want]) => (document.body?.innerText ?? '').includes(t) === want,
    [expected, present],
    { timeout: STEP_TIMEOUT },
  ).catch(() => {
    throw new Error(present
      ? `Text "${expected}" not found on the page`
      : `Text "${expected}" is still on the page`);
  });
}

// Logs in and returns the submit control's accessible name (captured for the IR).
async function doLogin(page, td) {
  await page.goto(`${td.BASE_URL}${LOGIN.path}`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT * 3 });
  const user = page.locator(LOGIN.username_selector);
  await user.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
  await user.fill(td[LOGIN.id_key] ?? '');
  await page.locator(LOGIN.password_selector).fill(td[LOGIN.password_key] ?? '');
  const submit = page.getByRole('button', { name: new RegExp(LOGIN.submit_text, 'i') }).first();
  const submitName = ((await submit.textContent().catch(() => '')) || '').trim();
  await submit.click();
  await page.waitForFunction(
    (p) => !location.pathname.startsWith(p), LOGIN.path, { timeout: STEP_TIMEOUT * 2 },
  );
  await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT }).catch(() => {});
  return submitName;
}

async function runStep(page, step, td, ctx) {
  switch (step.op) {
    case 'manual': throw new ManualSkip(step.note || 'manual verification required');
    case 'login': ctx.submitName = await doLogin(page, td); break;
    case 'logout': {
      const trigger = page.locator(LOGIN.logout_trigger_selector ?? 'button[aria-haspopup="menu"]').last();
      await trigger.click({ timeout: STEP_TIMEOUT });
      await page.getByRole('menuitem', { name: new RegExp(LOGIN.logout_text, 'i') }).first()
        .click({ timeout: STEP_TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT }).catch(() => {});
      break;
    }
    case 'goto':
      await page.goto(substitute(step.value, td), { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT * 3 });
      await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT }).catch(() => {});
      break;
    case 'fill': { const l = locator(page, step.selector, td).first(); ctx.last = l; await l.fill(substitute(step.value, td), { timeout: STEP_TIMEOUT }); break; }
    case 'click': { const l = locator(page, step.selector, td).first(); ctx.last = l; await l.click({ timeout: STEP_TIMEOUT }); break; }
    case 'click_text': { const l = page.getByText(substitute(step.value, td), { exact: true }).first(); ctx.last = l; await l.click({ timeout: STEP_TIMEOUT }); break; }
    case 'download': {
      const l = (step.selector ? locator(page, step.selector, td) : page.getByText(substitute(step.value, td))).first();
      ctx.last = l;
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: STEP_TIMEOUT }),
        l.click({ timeout: STEP_TIMEOUT }),
      ]);
      if (!dl || !dl.suggestedFilename()) throw new Error('Download did not start');
      break;
    }
    case 'assert_text': ctx.last = page.getByText(substitute(step.expect, td)).first(); await assertBodyText(page, substitute(step.expect, td), true); break;
    case 'assert_not_text': ctx.last = null; await assertBodyText(page, substitute(step.expect, td), false); break;
    case 'assert_url': {
      const want = substitute(step.expect, td);
      await page.waitForFunction((w) => location.href.includes(w), want, { timeout: STEP_TIMEOUT }).catch(() => {});
      if (!page.url().includes(want)) throw new Error(`URL does not contain "${want}" (current: ${page.url()})`);
      break;
    }
    case 'assert_visible': { const l = locator(page, step.selector, td).first(); ctx.last = l; await l.waitFor({ state: 'visible', timeout: STEP_TIMEOUT }); break; }
    case 'assert_attr': {
      const l = locator(page, step.selector, td).first(); ctx.last = l;
      await l.waitFor({ state: 'attached', timeout: STEP_TIMEOUT }).catch(() => {});
      const want = substitute(step.expect, td);
      const got = await l.getAttribute(step.attr, { timeout: STEP_TIMEOUT });
      const ok = step.attr === 'href' ? (got ?? '').includes(want) : got === want;
      if (!ok) throw new Error(`Attribute "${step.attr}" mismatch — expected "${want}", got "${got}"`);
      break;
    }
    default: throw new Error(`Unknown op: ${step.op}`);
  }
}

// Red-box the element under evidence, with a bounding-box overlay fallback for
// elements where CSS outline does not paint (e.g. <tr> in table layouts).
async function captureEvidence(page, loc, path) {
  let handle = null;
  try {
    if (loc) handle = await loc.first().elementHandle({ timeout: 1500 }).catch(() => null);
    if (handle) {
      await handle.evaluate((el) => {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const box = document.createElement('div');
        box.id = '__aqa_evidence_box';
        box.style.cssText = `position:fixed;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width}px;height:${r.height}px;border:3px solid #ef4444;pointer-events:none;z-index:99999`;
        document.body.appendChild(box);
      }).catch(() => {});
    }
    await page.screenshot({ path, fullPage: false });
    if (handle) await page.evaluate(() => document.getElementById('__aqa_evidence_box')?.remove()).catch(() => {});
  } catch { /* evidence capture is best-effort */ }
}

// ---- shared authenticated sessions (one live login per account, not per case) ----
const authStates = new Map(); // `${BASE_URL}|${id}` -> Promise<{state, submitName}>
function sharedAuth(browser, td) {
  const key = `${td.BASE_URL}|${td[LOGIN.id_key]}`;
  if (!authStates.has(key)) {
    authStates.set(key, (async () => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const p = await ctx.newPage();
      const submitName = await doLogin(p, td);
      const state = await ctx.storageState();
      await ctx.close();
      return { state, submitName };
    })().catch((e) => { authStates.delete(key); throw e; }));
  }
  return authStates.get(key);
}

// ---- per-case run ----
const submitNames = new Map(); // case_id -> submit accessible name (for the IR)

async function runCase(browser, c) {
  const td = c.test_data || {};
  const dir = `artifacts/${c.case_id}`;
  const res = {
    case_id: c.case_id, name: c.name, status: 'pass', tester: TESTER,
    finished_at: '', failure_reason: '', expected_vs_actual: '',
    evidence_path: '', discuss_note: '', jira_key: '',
  };
  // Manual-only case: no browser work — flag needs_discussion immediately.
  if (c.steps.length && c.steps[0].op === 'manual') {
    res.status = 'needs_discussion';
    res.discuss_note = c.steps[0].note || 'manual verification required';
    res.finished_at = new Date().toISOString();
    return res;
  }

  // Reuse one authenticated storageState per account for `login`-op cases;
  // cases that drive the login page itself get a clean context.
  let auth = null;
  const wantsLogin = c.steps.some((s) => s.op === 'login');
  if (wantsLogin && td[LOGIN.id_key] && td[LOGIN.password_key]) {
    auth = await sharedAuth(browser, td).catch(() => null); // fall back to in-case login
  }
  const context = await browser.newContext({
    ignoreHTTPSErrors: true, acceptDownloads: true,
    ...(auth ? { storageState: auth.state } : {}),
  });
  const page = await context.newPage();
  const ctx = { last: null, submitName: auth?.submitName ?? '' };

  try {
    for (let i = 0; i < c.steps.length; i++) {
      const step = c.steps[i];
      if (step.op === 'login' && auth) {
        // Session already authenticated — land on the app root instead.
        await page.goto(`${td.BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT * 3 });
        await page.waitForLoadState('networkidle', { timeout: STEP_TIMEOUT }).catch(() => {});
      } else {
        await runStep(page, step, td, ctx);
      }
      if (FULL_SHOT) {
        mkdirSync(dir, { recursive: true });
        const shot = `${dir}/step-${i + 1}.png`;
        await captureEvidence(page, ctx.last, shot);
        res.evidence_path = shot;
      }
    }
    if (ctx.submitName) submitNames.set(c.case_id, ctx.submitName);
  } catch (err) {
    mkdirSync(dir, { recursive: true });
    if (err instanceof ManualSkip) {
      res.status = 'needs_discussion';
      res.discuss_note = err.note;
      const shot = `${dir}/state.png`;
      await captureEvidence(page, ctx.last, shot);
      res.evidence_path = shot;
    } else {
      res.status = 'fail';
      const msg = String(err.message ?? err).split('\n')[0].slice(0, 500);
      res.failure_reason = msg;
      res.expected_vs_actual = `Expected: every step of "${c.name}" to pass\nActual: ${msg}`;
      const shot = `${dir}/failure.png`;
      await captureEvidence(page, ctx.last, shot);
      res.evidence_path = shot;
    }
  } finally {
    res.finished_at = new Date().toISOString();
    await context.close().catch(() => {});
  }
  return res;
}

// ---- results.csv (RFC 4180) ----
const COLS = ['case_id', 'name', 'status', 'tester', 'finished_at', 'failure_reason', 'expected_vs_actual', 'evidence_path', 'discuss_note', 'jira_key'];
const csvField = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function parseCSV(txt) {
  const out = []; let pos = txt.indexOf('\n') + 1; let field = ''; let row = []; let inQ = false;
  for (; pos < txt.length; pos++) {
    const ch = txt[pos];
    if (inQ) { if (ch === '"') { if (txt[pos + 1] === '"') { field += '"'; pos++; } else inQ = false; } else field += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); if (row.length > 1) out.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); if (row.length > 1) out.push(row); }
  return out.map((r) => Object.fromEntries(COLS.map((k, i) => [k, r[i] ?? ''])));
}

// ---- main ----
async function main() {
  const browser = await chromium.launch({ headless: !HEADED });
  const executed_at = new Date().toISOString();
  const results = new Array(CASES.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= CASES.length) return;
      const c = CASES[i];
      results[i] = await runCase(browser, c).catch((e) => ({
        case_id: c.case_id, name: c.name, status: 'fail', tester: TESTER,
        finished_at: new Date().toISOString(),
        failure_reason: `driver crash: ${String(e.message ?? e).slice(0, 300)}`,
        expected_vs_actual: '', evidence_path: '', discuss_note: '', jira_key: '',
      }));
      process.stderr.write(`[${i + 1}/${CASES.length}] ${c.case_id} ${results[i].status}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, CASES.length) }, worker));
  const finished_at = new Date().toISOString();
  await browser.close().catch(() => {});

  // Merge into an existing results.csv on a subset run (--only): update
  // matched rows in place, keep the rest. Full runs overwrite.
  let finalResults = results;
  if (ONLY.length) {
    let existing = [];
    try { existing = parseCSV(readFileSync('results.csv', 'utf8')); } catch { /* first run */ }
    const updated = Object.fromEntries(results.map((r) => [r.case_id, r]));
    finalResults = existing.map((row) => updated[row.case_id] ?? row);
    const seen = new Set(existing.map((r) => r.case_id));
    for (const r of results) if (!seen.has(r.case_id)) finalResults.push(r);
  }
  writeFileSync('results.csv', [COLS.join(','), ...finalResults.map((r) => COLS.map((k) => csvField(r[k])).join(','))].join('\n') + '\n', 'utf8');

  // cases.compiled.yaml — ALWAYS a pure rebuild from the union of currently
  // passing cases (compile-ir.md union rule); a subset rerun never drops
  // previously-passing cases.
  const passIds = new Set(finalResults.filter((r) => r.status === 'pass').map((r) => r.case_id));
  const irCases = compileIRCases(doc, passIds, submitNames);
  writeFileSync('cases.compiled.yaml',
    stringify({ ir_version: 2, name: doc.name, description: doc.description, cases: irCases }, { lineWidth: 120 }),
    'utf8');
  // Post-write check (mandatory): IR case count must equal pass row count.
  // (compileIRCases only skips a pass case when it has no compilable steps.)
  if (irCases.length !== passIds.size) {
    process.stderr.write(`WARNING: IR has ${irCases.length} cases but results.csv has ${passIds.size} pass rows — check for uncompilable passing cases.\n`);
  }

  const counts = finalResults.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  const meta = {
    executed_at, finished_at,
    duration_seconds: Math.round((Date.parse(finished_at) - Date.parse(executed_at)) / 1000),
    engine: 'playwright',
    base_url: doc.cases[0]?.test_data?.BASE_URL || '',
    browser: HEADED ? 'Chromium headed' : 'Chromium headless',
    commit_hash: process.env.COMMIT_HASH || '',
    tester: TESTER,
    total: finalResults.length,
    passed: counts.pass || 0, failed: counts.fail || 0,
    needs_discussion: counts.needs_discussion || 0,
  };
  writeFileSync('summary.json', JSON.stringify(meta, null, 2) + '\n', 'utf8');
  process.stderr.write(`DONE ${JSON.stringify({ total: meta.total, passed: meta.passed, failed: meta.failed, needs_discussion: meta.needs_discussion, ir_cases: irCases.length })}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
