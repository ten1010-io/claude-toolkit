# Claude Toolkit

By [Ten](https://github.com/ten1010-io) — A Claude Code plugin for AI-powered QA automation and Git workflow.

## Installation

```bash
# Step 1: Add to marketplace
/plugin marketplace add ten1010-io/claude-toolkit

# Step 2: Install
/plugin install claude-toolkit@ten1010-io
```

## Commands

### /aqa-smart

Analyzes a Figma design file to automatically generate YAML test scenarios, pauses for human review, then runs them against your live service.

**Usage:**

```
/aqa-smart <figma_url> <target_url> [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--headed` | Yes | Run browser with visible window |
| `--headless` | No | Run in headless mode |
| `--screenshot` | Off | Capture before/after screenshots per step |
| `--parallel N` | 2 | Run N cases concurrently |
| `--save <path>` | `scenarios/` | Directory to save generated YAML |

**Examples:**

```
/aqa-smart https://www.figma.com/file/xxx/Login https://app.example.com
/aqa-smart https://www.figma.com/file/xxx/Login https://app.example.com --headless
/aqa-smart https://www.figma.com/file/xxx/Dashboard https://app.example.com --screenshot --save scenarios/dashboard/
```

**Prerequisites:**
- Figma Personal Access Token — generate at: Figma → Profile → Settings → Security → Personal access tokens
- Save token to `.env`: `FIGMA_ACCESS_TOKEN=figd_xxxxxxxx` (or the command will ask you)
- [browser-use](https://github.com/browser-use/browser-use) CLI installed (uv venv + Python 3.12 recommended)

---

### /aqa-gen

Interactive scenario generator that creates YAML test files through a guided Q&A process.

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

### /aqa-run

Executes YAML test scenarios via browser-use CLI and generates HTML reports.

**Usage:**

```
/aqa-run <scenario_path> [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--headed` | Yes | Run with a visible browser window |
| `--headless` | No | Run in headless mode |
| `--screenshot` | Off | Capture before/after screenshots per step |
| `--parallel N` | 2 | Run N cases concurrently |

**Examples:**

```
/aqa-run scenarios/auth/login.yaml
/aqa-run scenarios/auth/                        # run all scenarios in directory
/aqa-run scenarios/auth/login.yaml --headless
/aqa-run scenarios/auth/login.yaml --screenshot --parallel 4
```

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
      - action: "Navigate to ${BASE_URL}/login"
      - action: "Enter ${username} in the ID input field"
      - action: "Enter ${password} in the password field"
        sensitive: true
      - action: "Click the login button"
      - action: "Verify that Dashboard text is visible"
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
      - action: "Navigate to ${BASE_URL}/login"
      - action: "Enter ${username} in the ID input field"
      - action: "Enter ${password} in the password field"
        sensitive: true
      - action: "Click the login button"
      - action: "Verify that an error message is displayed"
    cleanup:
      - type: clear_cookies
```

Each step only needs the `action` field — Claude reads the natural language and determines the appropriate browser commands automatically.

**Prerequisites:**
- [browser-use](https://github.com/browser-use/browser-use) CLI installed (uv venv + Python 3.12 recommended)

---

### /pr

Analyzes branch changes, generates a PR title and description, then pushes and creates the PR.

**Usage:**

```
/pr [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--base <branch>` | auto-detect | Base branch to compare against |
| `--draft` | No | Create as draft PR |

**Prerequisites:**
- [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`)

---

### /merge-check

Dry-run merge check — fetches the latest target branch and tests if the current branch can merge cleanly.

**Usage:**

```
/merge-check [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--target <branch>` | auto-detect | Target branch to merge into |

---

## Structure

```
claude-toolkit/
├── .claude-plugin/
│   ├── plugin.json        # Plugin metadata
│   └── marketplace.json   # Marketplace catalog
├── commands/
│   ├── aqa-smart.md
│   ├── aqa-gen.md
│   ├── aqa-run.md
│   ├── pr.md
│   └── merge-check.md
└── skills/
    ├── aqa-smart/
    │   └── SKILL.md
    ├── aqa-gen/
    │   └── SKILL.md
    ├── aqa-run/
    │   ├── SKILL.md
    │   └── references/
    │       └── report-template.html
    ├── pr/
    │   └── SKILL.md
    └── merge-check/
        └── SKILL.md
```

## License

MIT
