# Claude Toolkit

**English** | [한국어](README.ko.md)

By [Ten](https://github.com/ten1010-io) — A Claude Code plugin for AI-powered QA automation and Git workflow.

## Installation

```bash
# Step 1: Add to marketplace
/plugin marketplace add ten1010-io/claude-toolkit

# Step 2: Install
/plugin install claude-toolkit@ten1010-io
```

## Commands

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
| `--target <url>` | — | Live service URL — required when `--figma` and `--cases` are absent (exploration mode); stored as `BASE_URL` |
| `--cases <path>` | — | Execute an existing `cases.yaml` directly, skipping generation (cases must carry a `case_id`) |
| `--engine browser-use\|playwright` | `browser-use` | Execution engine: `browser-use` (AI screenshots) or `playwright` (DOM) |

**Examples:**

```
/aqa-inspect --target https://app.example.com
/aqa-inspect --figma https://www.figma.com/file/xxx/Login --target https://app.example.com
/aqa-inspect --target https://app.example.com --engine playwright
```

**Output:** a report directory containing `results.csv` (per-case `status`: `pass` / `fail` / `needs_discussion`, plus tester, time, reasons), `summary.json` (run metadata + counts), and `report.html`. A **playwright**-engine run additionally writes `cases.compiled.yaml` — a deterministic, LLM-free IR of the passing cases for offline re-execution by [`aqa-runner`](https://github.com/ten1010-io/aqa-runner).

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

## Related: offline execution with `aqa-runner`

`/aqa-inspect` needs Claude Code to run — it interprets each natural-language
step with an LLM. That can't run inside an air-gapped / closed network.

[**`ten1010-io/aqa-runner`**](https://github.com/ten1010-io/aqa-runner) closes
that gap: it executes a **compiled** `cases.compiled.yaml` (a deterministic,
LLM-free IR) with Playwright, requiring no Claude, no npm, and no network at run
time. It ships as a self-contained per-OS bundle (portable Node + Chromium) you
download from its Releases and run by double-click.

A **playwright**-engine `/aqa-inspect` run produces that IR directly — no manual
authoring. As it executes each passing case it records the resolved
operation, selector, value, and assertion, and writes `cases.compiled.yaml` into
the report dir.

```
[Local dev, Claude available]            [Air-gapped machine]
/aqa-inspect --engine playwright    →    aqa-runner executes cases.compiled.yaml
  runs live → emits cases.compiled.yaml  → results.csv + report.html (pass/fail)
            │                                        ▲
            └──────── cases.compiled.yaml ───────────┘ (file transfer)
```

`aqa-runner` emits the **same** `results.csv` schema, so the human-review →
`/aqa-jira` half of the pipeline works unchanged on results carried back out.
Design + plan: [`docs/superpowers/specs/2026-06-19-aqa-runner-offline-design.md`](docs/superpowers/specs/2026-06-19-aqa-runner-offline-design.md).

---

### /create-pr

Analyzes branch changes, generates a PR title and description (always including a mermaid sequence diagram of the changed flow), then pushes and creates the PR.

**Usage:**

```
/create-pr [options]
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
│   ├── aqa-inspect.md
│   ├── aqa-jira.md
│   ├── create-pr.md
│   └── merge-check.md
└── skills/
    ├── aqa-inspect/
    │   ├── SKILL.md
    │   └── references/
    ├── aqa-jira/
    │   ├── SKILL.md
    │   └── references/
    ├── create-pr/
    │   └── SKILL.md
    └── merge-check/
        └── SKILL.md
```

## License

MIT
