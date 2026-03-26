# Claude Toolkit

By [Ten](https://github.com/ten1010-io) — A Claude Code plugin for AI-powered QA automation.

## Installation

```bash
# Step 1: Add to marketplace
/plugin marketplace add ten1010-io/claude-toolkit

# Step 2: Install
/plugin install claude-toolkit@claude-toolkit
```

## Commands

### /aqa-run

AI-driven QA automation that executes YAML test scenarios via browser-use CLI.

**Features:**
- YAML-based test scenario definition with `cases` structure (multiple test cases per file)
- AI-powered element detection (no CSS selectors needed)
- `expected_result: "fail"` support for error/negative test cases
- Automatic SSL certificate warning bypass
- Parallel execution with worker pool pattern
- Optional screenshot capture (before/after per step)
- HTML report + summary.json generation
- Sensitive data masking in reports
- browser-use CLI auto-detection (global, project venv, home venv)

**Usage:**

```
/aqa-run scenarios/auth/login.yaml
/aqa-run scenarios/auth/                       # run all scenarios in directory
/aqa-run scenarios/auth/login.yaml --headless  # headless mode
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--headed` | Yes | Run with a visible browser window |
| `--headless` | No | Run in headless mode (no browser UI) |
| `--screenshot` | Off | Capture before/after screenshots for every step |
| `--parallel N` | 2 | Run N cases concurrently in separate browser sessions |

```
# Fast run (default): no screenshots, 2 cases in parallel
/aqa-run login.yaml

# With screenshots
/aqa-run login.yaml --screenshot

# Run 4 cases in parallel, headless
/aqa-run login.yaml --parallel 4 --headless

# Sequential execution (1 at a time)
/aqa-run login.yaml --parallel 1
```

> **Note:** When running in parallel, resource-creating values (e.g., project names) are automatically suffixed with `_1`, `_2`, etc. to avoid conflicts between concurrent cases.

**Scenario format:**

```yaml
name: "Login"
description: "Verify login functionality"
tags: [auth, smoke]

cases:
  - name: "Successful login"
    priority: critical
    expected_result: "pass"
    test_data:
      BASE_URL: "https://example.com"
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
      BASE_URL: "https://example.com"
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

Each step only needs the `action` field — Claude reads the natural language description and determines the appropriate browser commands automatically. All variables including `BASE_URL` must be defined in `test_data`.

Legacy single-scenario format (without `cases`) is also supported for backward compatibility.

---

### /aqa-gen

Interactive scenario generator that creates YAML test files through a guided Q&A process.

**Features:**
- Step-by-step guided input collection
- `BASE_URL` automatically saved into `test_data` (no re-entry needed on re-run)
- Login precondition support (auto-prepends login steps to every case)
- Automatic error case generation based on feature type (login, signup, search, form submission)
- Auto-generated tags from feature name/description
- Multi-language support (responds in the user's language)

**Usage:**

```
/aqa-gen
```

The command will ask you:
1. Feature name (e.g., Login, Signup)
2. Description
3. Login required? (auto-prepends login steps if yes)
4. Target page URL (BASE_URL is extracted and saved automatically)
5. Test data for the success case
6. Steps for the success case
7. Whether to auto-generate error cases
8. Save path

**Prerequisites:**
- [browser-use](https://github.com/browser-use/browser-use) CLI installed (uv venv + Python 3.12 recommended)

---

## Structure

```
claude-toolkit/
├── .claude-plugin/
│   ├── plugin.json        # Plugin metadata
│   └── marketplace.json   # Marketplace catalog
├── commands/
│   ├── aqa-run.md         # /aqa-run command
│   └── aqa-gen.md         # /aqa-gen command
└── skills/
    ├── aqa-run/
    │   ├── SKILL.md
    │   └── references/
    │       └── report-template.html
    └── aqa-gen/
        └── SKILL.md
```

## License

MIT
