---
description: Run YAML-based QA test scenarios via browser-use CLI and generate HTML reports. Use this command whenever the user wants to run, execute, or test YAML scenario files — even if they just say "테스트 실행해줘", "run the test", "run this scenario", or give a path to a .yaml file.
---

# aqa-run

This command runs YAML test scenarios using AI-driven browser automation and produces `summary.json` + `report.html`.

## Usage

```
/aqa-run <scenario_path> [options]
```

## Arguments

- `<scenario_path>` — Path to a YAML scenario file or directory (required)

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--headed` | Yes | Run with a visible browser window |
| `--headless` | No | Run in headless mode |
| `--screenshot` | Off | Capture before/after screenshots per step |
| `--parallel N` | 2 | Run N cases concurrently |

## Examples

```
/aqa-run scenarios/auth/login.yaml
/aqa-run scenarios/auth/
/aqa-run scenarios/auth/login.yaml --headless
/aqa-run scenarios/auth/login.yaml --screenshot --parallel 4
```

## Implementation

This command is powered by the skill at `skills/aqa-run/SKILL.md`.
Read that file for the full execution workflow.
