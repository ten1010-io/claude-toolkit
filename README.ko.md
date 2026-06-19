# Claude Toolkit

[English](README.md) | **한국어**

[Ten](https://github.com/ten1010-io) 제작 — AI 기반 QA 자동화와 Git 워크플로우를 위한 Claude Code 플러그인.

## 설치

```bash
# 1단계: 마켓플레이스 추가
/plugin marketplace add ten1010-io/claude-toolkit

# 2단계: 설치
/plugin install claude-toolkit@ten1010-io
```

## 명령어

### /aqa-inspect

명령어 하나로 처리하는 엔드투엔드 AI QA — 테스트 케이스를 **생성**(Figma 디자인 기반 또는 실제 URL 탐색)하고, 선택한 엔진으로 **실행**하며, 케이스별 결과를 `results.csv`에 **기록**하고, HTML 리포트를 **렌더링**한다. Jira 티켓은 절대 생성하지 않는다 — 티켓 발행은 `/aqa-jira`가 따로 담당한다.

**사용법:**

```
/aqa-inspect [--figma <url> | -f <url>] [--target <url>] [options]
```

**옵션:**

| 옵션 | 기본값 | 설명 |
|--------|---------|-------------|
| `--figma <url>` / `-f <url>` | — | Figma 파일 또는 프레임 URL — 디자인 기반으로 케이스 생성 |
| `--target <url>` | — | 실제 서비스 URL — `--figma`와 `--cases`가 없을 때 필수(탐색 모드), `BASE_URL`로 저장됨 |
| `--cases <path>` | — | 기존 `cases.yaml`을 바로 실행, 생성 단계 생략(각 케이스에 `case_id` 필요) |
| `--engine browser-use\|playwright` | `browser-use` | 실행 엔진: `browser-use`(AI 스크린샷) 또는 `playwright`(DOM) |

**예시:**

```
/aqa-inspect --target https://app.example.com
/aqa-inspect --figma https://www.figma.com/file/xxx/Login --target https://app.example.com
/aqa-inspect --target https://app.example.com --engine playwright
```

**산출물:** `results.csv`(케이스별 `status`: `pass` / `fail` / `needs_discussion`, 테스터·시간·사유 포함), `summary.json`(실행 메타데이터 + 집계), `report.html`을 담은 리포트 디렉터리.

**사전 요구사항:**
- [browser-use](https://github.com/browser-use/browser-use) CLI(browser-use 엔진) 또는 [Playwright](https://playwright.dev/)(playwright 엔진)
- Figma 모드: `.env`에 `FIGMA_ACCESS_TOKEN`

---

### /aqa-jira

`/aqa-inspect`가 생성한 `results.csv`를 읽어 **실패한** 케이스마다 Jira 티켓 초안을 작성(실패 상세 + 스크린샷)하고, 기존 티켓과 중복 제거한 뒤, **명시적인 사람 승인 후에만** 티켓을 생성하고 반환된 티켓 키를 `results.csv`에 다시 기록한다. `status=fail` 행만 읽으며, `pass`와 `needs_discussion`은 절대 티켓화하지 않는다. 이 명령어는 테스트를 실행하지 않는다.

**사용법:**

```
/aqa-jira (--results <path> | <reports_dir>) [options]
```

**옵션:**

| 옵션 | 기본값 | 설명 |
|--------|---------|-------------|
| `--results <path>` | — | 읽어들일 `results.csv` 경로 |
| `<reports_dir>` (위치 인자) | — | 리포트 디렉터리; 내부에서 `results.csv`를 찾음(`--results`와 택일) |
| `--project <KEY>` | 질문 | 대상 Jira 프로젝트 키(예: `PROJ`) — 없으면 물어봄 |

**사전 요구사항:**
- Atlassian/Jira MCP 연결(티켓 생성용)
- 이전 `/aqa-inspect` 실행으로 생성된 `results.csv`

---

### QA 파이프라인

`aqa-inspect`와 `aqa-jira` 두 명령어는 사람이 게이트를 지키는 QA 파이프라인을 이룬다:

```
/aqa-inspect          →   사람 검토            →   /aqa-jira
(생성 → 실행 →            (report.html 확인,       (fail 행 → Jira
 results.csv +            fail 행 확정)            티켓, 승인 게이트)
 report.html)
```

1. **`/aqa-inspect`** — 테스트 케이스를 생성·실행하고, `results.csv`(케이스별 `pass` / `fail` / `needs_discussion`)와 HTML 리포트를 작성한다.
2. **사람 검토** — 담당자가 리포트를 읽고, 어떤 `fail` 행이 진짜인지 확정하며, `needs_discussion` 케이스를 처리한다.
3. **`/aqa-jira`** — `results.csv`의 `fail` 행을 읽어, 명시적 승인 게이트 뒤에서 Jira 티켓을 발행하고 각 티켓 키를 `results.csv`에 다시 기록한다.

---

### /pr

브랜치 변경 사항을 분석해 PR 제목과 설명을 생성하고, 푸시한 뒤 PR을 만든다. PR 본문에는 변경된 흐름을 나타내는 mermaid 시퀀스 다이어그램이 항상 포함된다.

**사용법:**

```
/pr [options]
```

**옵션:**

| 옵션 | 기본값 | 설명 |
|--------|---------|-------------|
| `--base <branch>` | 자동 감지 | 비교 대상 베이스 브랜치 |
| `--draft` | 아니오 | 드래프트 PR로 생성 |

**사전 요구사항:**
- [GitHub CLI](https://cli.github.com/) 설치 및 인증(`gh auth login`)

---

### /merge-check

드라이런 머지 체크 — 최신 대상 브랜치를 가져와 현재 브랜치가 충돌 없이 머지되는지 테스트한다.

**사용법:**

```
/merge-check [options]
```

**옵션:**

| 옵션 | 기본값 | 설명 |
|--------|---------|-------------|
| `--target <branch>` | 자동 감지 | 머지 대상 브랜치 |

---

## 구조

```
claude-toolkit/
├── .claude-plugin/
│   ├── plugin.json        # 플러그인 메타데이터
│   └── marketplace.json   # 마켓플레이스 카탈로그
├── commands/
│   ├── aqa-inspect.md
│   ├── aqa-jira.md
│   ├── pr.md
│   └── merge-check.md
└── skills/
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

## 라이선스

MIT
