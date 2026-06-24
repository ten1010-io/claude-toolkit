// render.mjs — deterministic report renderer for aqa-inspect.
//
// Renders report.html from the report dir's own summary.json + results.csv
// (and optional selector-drift.json) using report-template.html. Handles
// BEGIN-CASE repetition, IF-<field> conditionals, token substitution, comment
// stripping, and the mandatory post-render validation.
//
// CRITICAL: every run-global token is sourced from summary.json — NOTHING is
// hardcoded. In particular META_ENGINE and META_BASE_URL come from
// summary.json's `engine` / `base_url`, so a browser-use run reports
// "browser-use" and a playwright run reports "playwright". Do not replace these
// with string literals.
//
// Usage (run from inside the report dir):
//   node render.mjs <path-to-report-template.html>
// Reads ./summary.json, ./results.csv, optional ./selector-drift.json; writes
// ./report.html.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const TEMPLATE = process.argv[2];
if (!TEMPLATE) {
  console.error('usage: node render.mjs <report-template.html>');
  process.exit(2);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csv = parseCsv(readFileSync('results.csv', 'utf8')).filter((r) => r.length > 1);
const header = csv[0];
const records = csv.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));

// Run metadata — the single source of truth, including the engine + base URL.
const meta = JSON.parse(readFileSync('summary.json', 'utf8'));

// Optional per-case selector-drift badges, keyed by case_id.
const drift = {};
if (existsSync('selector-drift.json')) {
  for (const rec of JSON.parse(readFileSync('selector-drift.json', 'utf8'))) {
    const line = `step ${rec.step}: ${rec.old} → ${rec.new}`;
    drift[rec.case_id] = drift[rec.case_id] ? `${drift[rec.case_id]}<br>${line}` : line;
  }
}

function humanDur(s) {
  s = Number(s) || 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h ? `${h}h` : '', (h || m) ? `${m}m` : '', `${sec}s`].filter(Boolean).join(' ');
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let tpl = readFileSync(TEMPLATE, 'utf8');

// Extract the per-case block.
const beginIdx = tpl.indexOf('<!-- BEGIN-CASE -->');
const endIdx = tpl.indexOf('<!-- END-CASE -->') + '<!-- END-CASE -->'.length;
const caseBlock = tpl.slice(beginIdx, endIdx)
  .replace('<!-- BEGIN-CASE -->', '').replace('<!-- END-CASE -->', '');

function renderCase(rec) {
  let b = caseBlock;
  const fields = {
    case_id: rec.case_id, case_name: rec.name, status: rec.status,
    STATUS: (rec.status || '').toUpperCase(), tester: rec.tester, finished_at: rec.finished_at,
    failure_reason: rec.failure_reason, expected_vs_actual: rec.expected_vs_actual,
    discuss_note: rec.discuss_note, evidence_path: rec.evidence_path,
    jira_key: rec.jira_key, selector_drift: drift[rec.case_id] || '',
  };
  // IF-<field> conditionals: keep the section only when the field is non-empty.
  for (const f of ['selector_drift', 'failure_reason', 'expected_vs_actual', 'discuss_note', 'evidence_path', 'jira_key']) {
    const re = new RegExp(`<!-- IF-${f} -->([\\s\\S]*?)<!-- ENDIF-${f} -->`, 'g');
    b = b.replace(re, fields[f] && String(fields[f]).trim() ? '$1' : '');
  }
  // Token substitution. evidence_path is an attribute value → not HTML-escaped;
  // selector_drift already contains intentional <br> markup → not escaped.
  for (const [k, v] of Object.entries(fields)) {
    const val = (k === 'evidence_path' || k === 'selector_drift') ? String(v ?? '') : esc(v);
    b = b.replaceAll(`{${k}}`, val);
  }
  return b;
}

const casesHtml = records.map(renderCase).join('\n');
let out = tpl.slice(0, beginIdx) + casesHtml + tpl.slice(endIdx);

const tokens = {
  META_EXECUTED_AT: meta.executed_at, META_FINISHED_AT: meta.finished_at,
  META_DURATION: humanDur(meta.duration_seconds),
  META_BASE_URL: meta.base_url, META_ENGINE: meta.engine, META_BROWSER: meta.browser,
  META_COMMIT_HASH: meta.commit_hash,
  TOTAL: meta.total, PASSED: meta.passed, FAILED: meta.failed,
  NEEDS_DISCUSSION: meta.needs_discussion,
};
for (const [k, v] of Object.entries(tokens)) out = out.replaceAll(`{{${k}}}`, esc(v));

// Strip all HTML comments (template machinery + contract block).
out = out.replace(/<!--[\s\S]*?-->/g, '');

// Mandatory validation.
const opens = (out.match(/<div\b/g) || []).length;
const closes = (out.match(/<\/div>/g) || []).length;
const caseCount = (out.match(/<div class="case"/g) || []).length;
const leftover = out.match(/\{\{?\w+\}?\}/g) || [];
const problems = [];
if (opens !== closes) problems.push(`div imbalance: ${opens} open vs ${closes} close`);
if (caseCount !== records.length) problems.push(`case count ${caseCount} != rows ${records.length}`);
if (leftover.length) problems.push(`leftover tokens: ${[...new Set(leftover)].join(', ')}`);
if (problems.length) { console.error('VALIDATION FAILED:\n' + problems.join('\n')); process.exit(2); }

writeFileSync('report.html', out, 'utf8');
console.log(`report.html OK — ${records.length} cases, engine ${meta.engine}, divs ${opens}/${closes}`);
