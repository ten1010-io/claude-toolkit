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
  BASE_URL: "https://example.com"
  username: "admin"
  password: "secret"

steps:
  - action: "${BASE_URL}/login 페이지로 이동"
  - action: "아이디 입력란에 ${username} 입력"
  - action: "비밀번호 입력란에 ${password} 입력"
  - action: "로그인 버튼 클릭"
  - action: "Dashboard 텍스트가 보이는지 확인"

cleanup:
  - type: clear_cookies
```

Each step only needs the `action` field — Claude reads the natural language description, inspects the page via `browser-use state`, and determines the appropriate browser commands automatically. All variables including `BASE_URL` are defined in `test_data`.

**Prerequisites:**
- [browser-use](https://github.com/browser-use/browser-use) CLI skill installed

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
