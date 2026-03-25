# Claude Toolkit

A collection of Claude Code skills and commands for AI-powered development workflows.

## Installation

```bash
npx skills add ten1010-io/claude-toolkit
```

Or install a specific skill:

```bash
npx skills add ten1010-io/claude-toolkit -s aqa-run
```

## Skills

### aqa-run

AI-driven QA automation that executes YAML test scenarios via browser-use CLI.

**Features:**
- YAML-based test scenario definition
- AI-powered element detection (no CSS selectors needed)
- Automatic SSL certificate warning bypass
- Screenshot capture at every step (before/after)
- HTML report + summary.json generation
- Sensitive data masking in reports

**Usage:**

```
/aqa-run scenarios/auth/login_success.yaml
/aqa-run scenarios/auth/                      # run all scenarios in directory
/aqa-run scenarios/auth/login.yaml --headless  # headless mode
```

**Scenario format:**

```yaml
name: "Login Test"
description: "Verify login with valid credentials"
priority: critical
tags: [auth, smoke]

test_data:
  username: "admin"
  password: "secret"

steps:
  - action: "Navigate to login page"
    url: "${BASE_URL}/login"
    assertions:
      - type: url_contains
        value: "/login"

  - action: "Enter username"
    input: "${username}"

  - action: "Enter password"
    input: "${password}"
    sensitive: true

  - action: "Click login button"
    wait_after: "load"

  - action: "Verify dashboard"
    assertions:
      - type: text_visible
        value: "Dashboard"

cleanup:
  - type: clear_cookies
```

**Prerequisites:**
- [browser-use](https://github.com/browser-use/browser-use) CLI skill installed
- `.env` file with `TARGET_BASE_URL` set

## Commands

_(Coming soon)_

## Structure

```
claude-toolkit/
  skills/
    aqa-run/
      SKILL.md
  commands/
    (future commands)
  README.md
```

## License

MIT
