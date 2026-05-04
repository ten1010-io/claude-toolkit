---
description: Generate YAML QA test scenario files. Default mode is an interactive Q&A; pass --figma <url> (or -f <url>) to auto-generate from a Figma design instead. Use this command whenever the user wants to create, generate, or scaffold a QA test scenario — even if they just say "시나리오 만들어줘", "make a test case", "generate a scenario", "피그마로 시나리오 만들어줘", or "Figma URL로 시나리오 생성해줘".
---

# aqa-spec

Generates YAML scenario files compatible with `/aqa-run`. Two input modes:

- **Q&A mode** (default): step-by-step interactive prompts.
- **Figma mode** (`--figma <url>` or `-f <url>`): analyzes a Figma design and drafts the YAML automatically, with a mandatory human review before saving.

## Usage

```
/aqa-spec [--figma <url> | -f <url>] [--target <url>] [--save <path>]
```

## Arguments

| Flag | Q&A mode | Figma mode | Description |
|---|---|---|---|
| `--figma <url>` / `-f <url>` | — | required | Figma file or frame URL |
| `--target <url>` | optional (asked if missing) | required | Live service URL — becomes `BASE_URL` in the YAML |
| `--save <path>` | optional (asked if missing) | optional (default `scenarios/`) | Save directory or file path |

## Examples

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

## What it does

### Q&A mode
1. Asks for feature name, description, login requirement, target URL, test data, success steps, error case strategy, and save path.
2. Generates the YAML and saves directly (no review gate — you authored every input).

### Figma mode
1. Resolves `FIGMA_ACCESS_TOKEN` from `.env` / `.env.local` / shell env (asks if missing).
2. Fetches the Figma file via REST API and analyzes UI components, flows, and test data hints.
3. Drafts the YAML scenario.
4. **Pauses for human review** (`ok` / `edit` / `save` / `cancel`) before saving.

Both modes finish by printing the save path and the suggested next command (`/aqa-run <path>`). Execution is delegated to `/aqa-run` — this command never runs scenarios itself.

## Implementation

This command is powered by the skill at `skills/aqa-spec/SKILL.md`.
Read that file for the full generation workflow.
