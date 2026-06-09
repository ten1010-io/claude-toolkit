# results.csv Schema Contract

`results.csv` is the integration contract between `aqa-inspect` (which **writes** it) and `aqa-jira` (which **reads** it). Both skills MUST agree on this schema exactly.

> **Authoritative contract:** This file is the single source of truth for the `results.csv` schema. `skills/aqa-jira/references/csv-contract.md` MUST be a byte-identical copy of this file. If the two ever diverge, this file wins and the copy must be regenerated.

## Columns

The CSV has exactly these columns, in this order:

```
case_id, name, status, tester, finished_at, failure_reason, expected_vs_actual, evidence_path, discuss_note, jira_key
```

`status` ∈ `pass | fail | needs_discussion`.

## Per-Column Meaning

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

## CSV Rules

- **Encoding:** UTF-8.
- **Header row:** Required. The first line MUST be the column names in the exact order listed above.
- **Quoting (RFC 4180):** Any field that contains a comma (`,`), a newline, or a double quote (`"`) MUST be wrapped in double quotes. An embedded double quote inside a quoted field MUST be escaped by doubling it (`"` → `""`).
- **Empty optional fields:** Use the empty string (i.e., nothing between the delimiters) for any optional field that is not set. Do not write `null`, `N/A`, or placeholder text.
- **`finished_at` may be empty:** Leave `finished_at` empty if the case never finished (e.g., it crashed or was aborted before completion); it is not always populated.

## Example

A 3-row example (one `pass`, one `fail`, one `needs_discussion`):

```csv
case_id,name,status,tester,finished_at,failure_reason,expected_vs_actual,evidence_path,discuss_note,jira_key
login-001,Login with valid credentials,pass,alice,2026-06-10T09:15:00Z,,,,,
login-002,"Login, wrong password",fail,alice,2026-06-10T09:16:30Z,"Error toast never appeared","Expected: ""Invalid password"" toast; Actual: page reloaded silently",evidence/login-002.png,,PROJ-123
checkout-007,Apply expired coupon at checkout,needs_discussion,bob,2026-06-10T09:20:10Z,,"Expected: coupon rejected; Actual: 0% discount applied with no message",evidence/checkout-007.png,Spec unclear whether expired coupon should error or silently no-op,
```

Notes on the example:

- The `pass` row leaves all failure/discussion/evidence/jira fields empty.
- The `fail` row quotes `name` because the value contains a comma (`Login, wrong password`), and quotes `expected_vs_actual` because it contains embedded double quotes (`""Invalid password""` is the doubled-quote escape for `"Invalid password"`). It carries a `jira_key` because `aqa-jira` already created a ticket.
- The `needs_discussion` row fills `expected_vs_actual` and `discuss_note`, leaves `failure_reason` and `jira_key` empty.
