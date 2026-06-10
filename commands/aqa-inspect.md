---
description: End-to-end AI QA — generate test cases (from a Figma design or by exploring a live URL), execute them with a selectable engine, track per-case results, and emit an HTML report. Use whenever the user wants to inspect/QA a page or design end to end — "QA 돌려줘", "이 페이지 점검해줘", "피그마로 테스트 만들고 실행까지", "run full QA".
---

# aqa-inspect

Runs the full QA loop in one command: **generate** test cases, **execute** them with a selectable engine, **track** per-case results into `results.csv`, and **render** an HTML report.

> This command **never creates Jira tickets**. Filing issues is handled separately by `/aqa-jira`.

## Usage

```
/aqa-inspect [--figma <url> | -f <url>] [--target <url>] [options]
```

## Arguments

| Option | Default | Description |
|--------|---------|-------------|
| `--figma <url>` / `-f <url>` | — | Figma file or frame URL to generate test cases from (full file structure is enumerated; a node-id is only an entry point) |
| `--figma-token <token>` | env / ask | Figma Personal Access Token (falls back to `FIGMA_ACCESS_TOKEN` env, then asks) |
| `--target <url>` | — | Live service URL to explore and test against |
| `--cases <path>` | — | Execute an existing `cases.yaml` directly, skipping generation (cases must carry a `case_id` per `skills/aqa-inspect/references/cases-yaml.md`; the drafted-case human review gate is skipped for user-provided files) |
| `--engine browser-use\|playwright` | ask | Execution engine (browser-use screenshots or Playwright DOM). If omitted, you'll be asked to pick one at the start |
| `--tester <name>` | — | Tester name recorded in `results.csv` |
| `--screenshot` | Off | Full capture mode: per-step screenshots for every case. Failure-moment screenshots are always captured regardless of this flag |
| `--headed` | Yes | Run with a visible browser window |
| `--headless` | No | Run in headless mode |
| `--parallel N` | 2 | Run N cases concurrently |
| `--rerun-failed` | Off / auto-ask | Re-run only the cases that previously failed. Even without the flag, if the latest report has unresolved cases you'll be asked whether to re-run them |
| `--resume <reports_dir>` | — | Resume from an existing reports directory |

## Examples

```
# Explore a live URL end to end
/aqa-inspect --target https://app.example.com

# Generate from a Figma design and run against the live service
/aqa-inspect --figma https://www.figma.com/file/xxx/Login --target https://app.example.com

# Execute an existing cases.yaml directly (no generation)
/aqa-inspect --cases cases/login.yaml

# Use the Playwright engine, headless, 4 cases at a time
/aqa-inspect --target https://app.example.com --engine playwright --headless --parallel 4

# Capture screenshots and record the tester
/aqa-inspect --target https://app.example.com --screenshot --tester joonseo

# Re-run only failed cases from a previous run
/aqa-inspect --resume reports/2026-06-10_14-30-00/ --rerun-failed
```

## Implementation

This command is powered by the skill at `skills/aqa-inspect/SKILL.md`.
Read that file for the full orchestration workflow.

This command **never creates Jira tickets** — use `/aqa-jira` for that.
