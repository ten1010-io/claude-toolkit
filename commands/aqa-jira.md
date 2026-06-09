---
description: Read aqa-inspect results.csv and create Jira tickets for failed test cases behind a human approval gate. Use this command when the user says "실패한 테스트 지라에 올려줘", "create Jira tickets from QA results", "티켓 생성해줘".
---

# aqa-jira

This command reads the `results.csv` produced by `aqa-inspect`, drafts a Jira ticket for each **failed** case (failure details + screenshots), dedups against existing tickets, and — only after explicit human approval — creates the tickets and writes each returned key back into `results.csv`.

It reads `status=fail` rows ONLY. `pass` and `needs_discussion` rows are never ticketed. This command never runs tests.

## Usage

```
/aqa-jira (--results <path> | <reports_dir>) [options]
```

## Arguments

- `--results <path>` — Path to the `results.csv` to read, OR
- `<reports_dir>` — A report directory; `results.csv` is located inside it.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--project <KEY>` | ask | Target Jira project key (e.g. `PROJ`). Asked if omitted. |
| `--issue-type <type>` | Bug (ask) | Jira issue type. Asked if omitted; defaults to `Bug`. |

## Human Approval Gate

Before any Jira write, this command presents the full draft list (each failure's summary, and whether it is new or already-ticketed) and asks for **explicit approval**. Nothing is created, attached, or modified in Jira until the user approves. The gate is mandatory.

## Examples

```
/aqa-jira reports/2026-06-10_09-15-00/
/aqa-jira --results reports/2026-06-10_09-15-00/results.csv --project PROJ
/aqa-jira reports/2026-06-10_09-15-00/ --project PROJ --issue-type Bug
```

## Implementation

This command is powered by the skill at `skills/aqa-jira/SKILL.md`.
Read that file for the full workflow, the results.csv contract, and the ticket/dedup template.
