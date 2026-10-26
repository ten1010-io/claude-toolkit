# Ten Toolkit

**English** | [한국어](README.ko.md)

By [Ten](https://github.com/ten1010-io) — A Claude Code plugin for AI-powered QA automation and Git workflow.

## Installation

```bash
# Step 1: Add the marketplace (once)
/plugin marketplace add ten1010-io/ten-toolkit

# Step 2: Install the plugins you need
/plugin install ten-toolkit@ten1010-io    # QA automation + Git workflow commands
/plugin install java-team@ten1010-io      # Java team shared skills
```

The `ten1010-io` marketplace carries **two independently versioned plugins**. Installing one does not install the other — pick what you need.

Run `/plugin` to confirm what is installed, then invoke a command by name:

```
/aqa-inspect --target https://app.example.com   # ten-toolkit
/create-pr                                       # ten-toolkit
/java-team:meeting-prep                          # java-team
```

Third-party marketplaces don't auto-update by default. Turn it on once: `/plugin` → **Marketplaces** → `ten1010-io` → **Enable auto-update**. Otherwise pull new versions yourself with `/plugin marketplace update ten1010-io`.

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

**Output:** a report directory containing `results.csv` (per-case `status`: `pass` / `fail` / `needs_discussion`, plus tester, time, reasons), `summary.json` (run metadata + counts), and `report.html`. Either engine additionally writes `cases.compiled.yaml` — a deterministic, LLM-free IR of the passing cases for offline re-execution by [`aqa-runner`](https://github.com/ten1010-io/aqa-runner).

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

An `/aqa-inspect` run (either engine) produces that IR directly — no manual
authoring. As it executes each passing case it records the resolved
operation, selector, value, and assertion, and writes `cases.compiled.yaml` into
the report dir. (Playwright yields sturdier selectors; browser-use works too.)

```
[Local dev, Claude available]            [Air-gapped machine]
/aqa-inspect (run live)             →    aqa-runner executes cases.compiled.yaml
  → emits cases.compiled.yaml            → results.csv + report.html (pass/fail)
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

## java-team plugin

A separate plugin in the same marketplace with shared skills for Ten's Java team (Dev Team 3). It is versioned independently of `ten-toolkit`.

```bash
/plugin marketplace add ten1010-io/ten-toolkit   # skip if already added
/plugin install java-team@ten1010-io
```

**Turn on auto-update (once):** third-party marketplaces don't auto-update by default. Run `/plugin` → **Marketplaces** → `ten1010-io` → **Enable auto-update**. New versions are downloaded after a session starts and load from the next session. Without it, run `/plugin marketplace update ten1010-io`.

### /java-team:meeting-prep

Prepares your own section for the Java team meeting. Picks the meeting from when you run it, then collects Jira tickets, Confluence pages you edited, GitHub commits/PRs/issues and your replies in the daily Slack work-share thread since the last meeting, lets you pick what to share, formats it for the meeting type, and — only after your review — writes it to your `### <name>` section of the Confluence meeting page.

| | Monday — quick share | Wednesday — weekly review |
|---|---|---|
| Run on | Monday | Tuesday afternoon – Wednesday |
| Items | 5 numbered top-level items, no sub-items | Up to 5 numbered items, sub-items for focus items |
| Range | Since the last meeting | Since the last Wednesday meeting, plus your Monday section (never dropped) |
| You decide | The big items | Which items to focus on, together with the skill |
| Visuals | — | A table or diagram when it helps; anything too large for one block becomes an Artifact you link |

**Usage:**

```
/java-team:meeting-prep
```

Or just say what you want — "prepare my meeting notes", "스크럼 준비해줘". The skill decides which meeting from the current day and time, and asks you if it can't tell.

**Example — first run:**

```
> /java-team:meeting-prep

Monday 10:04 — preparing the Monday quick share.
First run, so two questions: a link to a recent meeting page, and your Slack
work-share channel (skip it if you don't use one).

> https://your-site.atlassian.net/wiki/spaces/XX/pages/123456/2026+10+23+43
> #team-work-share

Saved to meeting-prep.json. I won't ask again.

Collected since the last meeting (10/23):

Jira
 1. ABC-3477 Alert threshold editing — Done
 2. ABC-3561 Backend wiki — To Do
GitHub PR
 3. backend #742 rename the urgent level — merged
 4. web #1787 fix Alert spacing and badge colors — merged
Slack work-share replies
 5. 10/24 5.2.0 QA

[select]  Pick what to share  →  you choose 1+3+4 and 5

Draft for your review:

### <your name>
1. Admins can change alert thresholds from the screen ([Done](https://your-site.atlassian.net/browse/ABC-3477))
2. Full-feature check before shipping 5.2.0 (in progress)

Look right? I'll replace only your `### <your name>` section on the
meeting page — nothing else on it is touched.
```

Ticket keys never appear as text in the page body. Each item carries a status — **Done / in progress / planned** — and that status word links to the ticket.

**Prerequisites:** Atlassian (Jira/Confluence) connector, [GitHub CLI](https://cli.github.com/); Slack connector optional.

**First run:** asks once for a link to a recent meeting page and the Slack work-share channel, then saves them to `meeting-prep.json` in the plugin data directory (`~/.claude/plugins/data/…`, kept across updates). Say "reset meeting settings" to change them.

**Releasing a change:** bump `version` in `plugins/java-team/.claude-plugin/plugin.json` (set it only there, not in `marketplace.json`). Users don't receive commits until the version string changes.

---

## Structure

```
ten-toolkit/
├── .claude-plugin/
│   ├── plugin.json        # Plugin metadata
│   └── marketplace.json   # Marketplace catalog
├── commands/
│   ├── aqa-inspect.md
│   ├── aqa-jira.md
│   ├── create-pr.md
│   └── merge-check.md
├── skills/
│   ├── aqa-inspect/
│   │   ├── SKILL.md
│   │   └── references/
│   ├── aqa-jira/
│   │   ├── SKILL.md
│   │   └── references/
│   ├── create-pr/
│   │   └── SKILL.md
│   └── merge-check/
│       └── SKILL.md
└── plugins/
    └── java-team/
        ├── .claude-plugin/
        │   └── plugin.json    # java-team plugin metadata (version)
        └── skills/
            └── meeting-prep/
                └── SKILL.md
```

## License

MIT
