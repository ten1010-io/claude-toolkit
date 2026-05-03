---
description: Automatically generate YAML QA test scenarios from a Figma design URL and execute them against a live target URL. Use when the user wants to create and run tests from a Figma link — even if they say "피그마로 테스트 만들어줘", "Figma URL로 시나리오 생성해줘", "auto-generate tests from design", or provides a Figma link with a target URL.
---

# aqa-smart

Analyzes a Figma design file to automatically generate YAML test scenarios, lets you review and adjust them, then runs them against your live service via browser-use.

## Usage

```
/aqa-smart <figma_url> <target_url> [options]
```

## Arguments

- `<figma_url>` — Figma file or frame URL (required)
- `<target_url>` — Live service URL to run tests against (required)

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--headed` | Yes | Run browser with visible window |
| `--headless` | No | Run in headless mode |
| `--screenshot` | Off | Capture before/after screenshots per step |
| `--parallel N` | 2 | Run N cases concurrently |
| `--save <path>` | `scenarios/` | Directory to save generated YAML files |

## Examples

```
/aqa-smart https://www.figma.com/file/xxx/Login --target https://app.example.com
/aqa-smart https://www.figma.com/file/xxx/Login https://app.example.com --headless
/aqa-smart https://www.figma.com/file/xxx/Dashboard https://app.example.com --screenshot --save scenarios/dashboard/
```

## What it does

1. Reads `FIGMA_ACCESS_TOKEN` from `.env` (asks if not found)
2. Fetches Figma file structure and extracts UI components, interactions, and flows
3. Auto-generates YAML test scenario draft (success + error cases)
4. Pauses for human review — you can edit or approve the draft
5. Saves confirmed YAML and runs it via `aqa-run` against `<target_url>`

## Implementation

This command is powered by the skill at `skills/aqa-smart/SKILL.md`.
Read that file for the full workflow.
