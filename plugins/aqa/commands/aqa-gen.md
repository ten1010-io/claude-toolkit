---
description: Interactively generate YAML QA test scenario files through a guided Q&A process. Use this command whenever the user wants to create, generate, or scaffold a QA test scenario — even if they just say "시나리오 만들어줘", "make a test case", "generate a scenario", or describe a feature they want to test.
---

# aqa-gen

This command interactively generates YAML scenario files with success and error cases through a step-by-step Q&A.

## Usage

```
/aqa-gen
```

No arguments needed — the command guides you through the process.

## What It Asks

1. Feature name
2. Description
3. Login required? (auto-prepends login steps if yes)
4. Target page URL
5. Test data for the success case
6. Steps for the success case
7. Auto-generate error cases?
8. Save path

## Output

A ready-to-run YAML scenario file compatible with `/aqa-run`.

## Implementation

This command is powered by the skill at `skills/aqa-gen/SKILL.md`.
Read that file for the full generation workflow.
