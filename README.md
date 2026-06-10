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

### /aqa-inspect

End-to-end AI QA in one command — **generates** test cases (from a Figma design or by exploring a live URL), **executes** them with a selectable engine, **tracks** per-case results into `results.csv`, and **renders** an HTML report. Never creates Jira tickets — filing is handled separately by `/aqa-jira`.

**Usage:**

```
/aqa-inspect [--figma <url> | -f <url>] [--target <url>] [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--figma <url>` / `-f <url>` | — | Figma file or frame URL — cases generated from the design |
| `--target <url>` | — | Live service URL — required when `--figma` is absent (exploration mode); stored as `BASE_URL` |
| `--engine browser-use\|playwright` | `browser-use` | Execution engine: `browser-use` (AI screenshots) or `playwright` (DOM) |

**Examples:**

```
/aqa-inspect --target https://app.example.com
/aqa-inspect --figma https://www.figma.com/file/xxx/Login --target https://app.example.com
/aqa-inspect --target https://app.example.com --engine playwright
```

**Output:** a report directory containing `results.csv` (per-case `status`: `pass` / `fail` / `needs_discussion`, plus tester, time, reasons), `summary.json` (run metadata + counts), and `report.html`.

**Prerequisites:**
- [browser-use](https://github.com/browser-use/browser-use) CLI (browser-use engine) or [Playwright](https://playwright.dev/) (playwright engine)
- For Figma mode: `FIGMA_ACCESS_TOKEN` in `.env`

---

### /aqa-jira

Reads the `results.csv` produced by `/aqa-inspect`, drafts a Jira ticket for each **failed** case (failure details + screenshots), dedups against existing tickets, and — only after explicit human approval — creates the tickets and writes each returned ticket key back into `results.csv`. Reads `status=fail` rows ONLY; `pass` and `needs_discussion` are never ticketed. This command never runs tests.

**Usage:**

```
/aqa-jira (--results <path> | <reports_dir>) [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--results <path>` | — | Path to the `results.csv` to read |
| `<reports_dir>` (positional) | — | A report directory; locates `results.csv` inside it (use this OR `--results`) |
| `--project <KEY>` | ask | Target Jira project key (e.g. `PROJ`) — asks if absent |

**Prerequisites:**
- Atlassian/Jira MCP connection (for creating tickets)
- A `results.csv` produced by a prior `/aqa-inspect` run

---

### QA Pipeline

The two `aqa-inspect` and `aqa-jira` commands form a human-gated QA pipeline:

```
/aqa-inspect          →   human review        →   /aqa-jira
(generate → run →         (read report.html,      (fail rows → Jira
 results.csv +            confirm fail rows)       tickets, approval-gated)
 report.html)
```

1. **`/aqa-inspect`** — generates and runs test cases, writing `results.csv` (with `pass` / `fail` / `needs_discussion` per case) and an HTML report.
2. **Human review** — a person reads the report, confirms which `fail` rows are genuine, and resolves any `needs_discussion` cases.
3. **`/aqa-jira`** — reads the `fail` rows from `results.csv` and, behind an explicit approval gate, files Jira tickets, writing each ticket key back into `results.csv`.

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
│   ├── aqa-inspect.md
│   ├── aqa-jira.md
│   ├── pr.md
│   └── merge-check.md
└── skills/
    ├── aqa-spec/
    │   └── SKILL.md
    ├── aqa-run/
    │   ├── SKILL.md
    │   └── references/
    │       └── report-template.html
    ├── aqa-inspect/
    │   ├── SKILL.md
    │   └── references/
    ├── aqa-jira/
    │   ├── SKILL.md
    │   └── references/
    ├── pr/
    │   └── SKILL.md
    └── merge-check/
        └── SKILL.md
```

## License

MIT
