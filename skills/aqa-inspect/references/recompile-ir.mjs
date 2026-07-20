#!/usr/bin/env node
// recompile-ir.mjs — rebuild cases.compiled.yaml (IR v2) from cases.yaml +
// results.csv WITHOUT re-executing anything. Compilation is a pure function of
// the case definition (compile.mjs), so this emits every case whose current
// results.csv status is `pass` — the union rule from compile-ir.md.
//
//   node recompile-ir.mjs [--cases ../../cases.yaml] [--results results.csv]
//
// Run it from the report dir after any manual edit to results.csv (e.g. the
// needs_discussion reclassification stage promoted cases to pass), or to
// repair an IR that dropped previously-passing cases.
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { compileIRCases } from './compile.mjs';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const CASES_PATH = opt('--cases', 'cases.yaml');
const RESULTS_PATH = opt('--results', 'results.csv');

const doc = parse(readFileSync(CASES_PATH, 'utf8'));

const COLS = ['case_id', 'name', 'status', 'tester', 'finished_at', 'failure_reason', 'expected_vs_actual', 'evidence_path', 'discuss_note', 'jira_key'];
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

const results = parseCSV(readFileSync(RESULTS_PATH, 'utf8'));
const passIds = new Set(results.filter((r) => r.status === 'pass').map((r) => r.case_id));

const irCases = compileIRCases(doc, passIds);
writeFileSync('cases.compiled.yaml',
  stringify({ ir_version: 2, name: doc.name, description: doc.description, cases: irCases }, { lineWidth: 120 }),
  'utf8');

const summary = { pass_in_csv: passIds.size, compiled_cases: irCases.length };
console.log(JSON.stringify(summary, null, 2));
if (summary.compiled_cases !== summary.pass_in_csv) {
  console.error('WARNING: compiled case count != pass row count — some passing cases have no compilable steps.');
  process.exit(2);
}
