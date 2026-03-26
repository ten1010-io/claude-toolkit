# Claude Toolkit

A collection of Claude Code skills for AI-powered QA automation.

## Installation

```bash
npx skills add ten1010-io/claude-toolkit
```

Or install a specific skill:

```bash
npx skills add ten1010-io/claude-toolkit -s aqa-run
npx skills add ten1010-io/claude-toolkit -s aqa-gen
```

## Skills

### aqa-run

AI-driven QA automation that executes YAML test scenarios via browser-use CLI.

**Features:**
- YAML-based test scenario definition with `cases` structure (multiple test cases per file)
- AI-powered element detection (no CSS selectors needed)
- `expected_result: "fail"` support for error/negative test cases
- Automatic SSL certificate warning bypass
- Screenshot capture at every step (before/after)
- HTML report + summary.json generation
- Sensitive data masking in reports
- browser-use CLI auto-detection (global, project venv, home venv)

**Usage:**

```
/aqa-run scenarios/auth/login.yaml
/aqa-run scenarios/auth/                      # run all scenarios in directory
/aqa-run scenarios/auth/login.yaml --headless  # headless mode
```

**Scenario format (cases structure):**

```yaml
name: "Login"
description: "Verify login functionality"
tags: [auth, smoke]

cases:
  - name: "Successful login"
    priority: critical
    expected_result: "pass"
    test_data:
      username: "testuser"
      password: "secret"
    steps:
      - action: "${BASE_URL}/login 페이지로 이동"
      - action: "아이디 입력란에 ${username} 입력"
      - action: "비밀번호 입력란에 ${password} 입력"
        sensitive: true
      - action: "로그인 버튼 클릭"
      - action: "Dashboard 텍스트가 보이는지 확인"
    cleanup:
      - type: clear_cookies

  - name: "Wrong password"
    priority: high
    expected_result: "fail"
    test_data:
      username: "testuser"
      password: "wrongpassword"
    steps:
      - action: "${BASE_URL}/login 페이지로 이동"
      - action: "아이디 입력란에 ${username} 입력"
      - action: "비밀번호 입력란에 ${password} 입력"
        sensitive: true
      - action: "로그인 버튼 클릭"
      - action: "에러 메시지가 표시되는지 확인"
    cleanup:
      - type: clear_cookies
```

Each step only needs the `action` field — Claude reads the natural language description, inspects the page via `browser-use state`, and determines the appropriate browser commands automatically. All variables including `BASE_URL` are defined in `test_data` or `.env`.

Legacy single-scenario format (without `cases`) is also supported for backward compatibility.

### aqa-gen

Interactive scenario generator that creates YAML test files through a guided Q&A process.

**Features:**
- Step-by-step guided input collection
- Automatic error case generation based on feature type (login, signup, search, form submission)
- `visual` assertion fallback when exact error messages are unknown
- Target page URL collection for accurate error case generation

**Usage:**

```
/aqa-gen
```

The skill will ask you:
1. Feature name (e.g., Login, Signup)
2. Description
3. Target page URL path
4. Tags
5. Test data for the success case
6. Steps for the success case
7. Whether to auto-generate error cases
8. Save path

**Prerequisites:**
- [browser-use](https://github.com/browser-use/browser-use) CLI installed (uv venv + Python 3.12 recommended)

## Commands

_(Coming soon)_

## Structure

```
claude-toolkit/
  skills/
    aqa-run/
      SKILL.md
    aqa-gen/
      SKILL.md
  commands/
    (future commands)
  login.yaml          # example scenario
  README.md
```

## License

MIT
