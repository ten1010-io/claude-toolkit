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

### /aqa-spec

Generates YAML test scenarios. Default mode is an interactive Q&A; pass `--figma <url>` (or `-f <url>`) to auto-generate from a Figma design instead.

**Usage:**

```
/aqa-spec [--figma <url> | -f <url>] [--target <url>] [--save <path>]
```

**Arguments:**

| Flag | Q&A mode | Figma mode | Description |
|---|---|---|---|
| `--figma <url>` / `-f <url>` | — | required | Figma file or frame URL |
| `--target <url>` | optional | required | Live service URL — saved as `BASE_URL` in the YAML |
| `--save <path>` | optional | optional (default `scenarios/`) | Save directory or full file path |

**Examples:**

```
# Q&A mode — fully interactive
/aqa-spec

# Q&A mode with target preset
/aqa-spec --target https://app.example.com

# Figma mode (long flag)
/aqa-spec --figma https://www.figma.com/file/xxx/Login --target https://app.example.com

# Figma mode (short flag) with custom save dir
/aqa-spec -f https://www.figma.com/file/xxx/Dashboard --target https://app.example.com --save scenarios/dashboard/
```

**Behavior:**

- **Q&A mode** asks for feature name, description, login requirement, target URL, test data, success steps, error case strategy, and save path, then saves the YAML directly.
- **Figma mode** fetches the Figma file, analyzes UI components and flows, drafts the YAML, and **pauses for human review** (`ok` / `edit` / `cancel`) before saving.
- Both modes finish by suggesting the next command: `/aqa-run <path>`. Execution is the responsibility of `/aqa-run` — `/aqa-spec` never runs scenarios.

**Prerequisites:**
- For Figma mode: Figma Personal Access Token (Figma → Profile → Settings → Security → Personal access tokens). Save to `.env`: `FIGMA_ACCESS_TOKEN=figd_xxxxxxxx` (or the command will ask).

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
│   ├── aqa-spec.md
│   ├── aqa-run.md
│   ├── pr.md
│   └── merge-check.md
└── skills/
    ├── aqa-spec/
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
