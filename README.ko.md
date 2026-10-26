# Ten Toolkit

[English](README.md) | **한국어**

[Ten](https://github.com/ten1010-io) 제작 — AI 기반 QA 자동화, Git 워크플로우, 팀 회의 준비를 위한 Claude Code 플러그인.

| 플러그인 | 버전 | 스킬 |
|---|---|---|
| [`ten-toolkit`](#명령어) | `0.5.0` | `/aqa-inspect` · `/aqa-jira` · `/create-pr` · `/merge-check` |
| [`java-team`](#java-team-플러그인) | `0.1.0` | `/java-team:meeting-prep` |

스킬은 플러그인 버전을 따라간다 — 스킬마다 따로 버전을 매기지 않는다. 설치된 것은 `/plugin` 으로 확인한다. **플러그인의 `version` 을 올릴 때 이 표도 같은 커밋에서 갱신한다.**

## 설치

```bash
# 1단계: 마켓플레이스 추가 (한 번만)
/plugin marketplace add ten1010-io/ten-toolkit

# 2단계: 필요한 플러그인 설치
/plugin install ten-toolkit@ten1010-io    # QA 자동화 + Git 워크플로우 명령어
/plugin install java-team@ten1010-io      # 개발3팀(JAVA팀) 공용 스킬
```

`ten1010-io` 마켓플레이스에는 **버전을 따로 관리하는 플러그인이 두 개** 있다. 하나를 설치해도 다른 하나는 깔리지 않으니 필요한 것만 고르면 된다.

`/plugin` 으로 설치 상태를 확인한 뒤 이름으로 호출한다.

```
/aqa-inspect --target https://app.example.com   # ten-toolkit
/create-pr                                       # ten-toolkit
/java-team:meeting-prep                          # java-team
```

## 최신 상태 유지

서드파티 마켓플레이스는 **기본으로 자동 업데이트가 꺼져 있다.**

### 자동 업데이트 켜기 (한 번만)

**이 토글에는 CLI 명령이 없다.** 대화형 메뉴에만 있으므로 Claude Code 세션 안에서 아래를 따라간다.

1. **`/plugin`** 을 입력하고 Enter.
2. **Marketplaces** 를 고른다. ↑ ↓ 로 옮기고 Enter 로 선택한다.
3. 목록에서 **`ten1010-io`** 를 고른다.
4. **Enable auto-update** 를 고른다. 항목이 *Disable* 쪽으로 보이면 이미 켜진 것이니 그대로 두고 나온다.
5. Esc 로 메뉴를 빠져나온다.

한 번만 하면 이 마켓에 대해 다시 할 일이 없다. 켜 두면 새 버전이 세션 시작 뒤 내려받아지고 **다음 세션부터 적용된다** — 쓰던 중에 플러그인이 바뀌지 않는다.

나중에 확인하려면 같은 화면을 다시 연다. 켜져 있으면 그 자리가 *끄는* 항목으로 바뀌어 있다.

### 직접 받기

셸에서:

```bash
claude plugin marketplace update ten1010-io   # 마켓 목록 갱신
claude plugin update java-team@ten1010-io     # 새 버전 받기 (적용은 재시작 후)
claude plugin list                            # 설치된 버전 확인
```

세션 안에서 같은 일을 하려면:

```
/plugin marketplace update ten1010-io
/plugin install java-team@ten1010-io
```

### 결국 `version` 문자열이 관문이다

설치 캐시가 버전으로 갈린다 — `~/.claude/plugins/cache/<마켓>/<플러그인>/<버전>/`. 그래서 **`plugin.json` 의 `version` 을 올리지 않고 스킬만 고쳐 머지하면 자동 업데이트를 켜 뒀든 아니든 아무에게도 가지 않는다.** 내보내고 싶은 변경은 아무리 작아도 버전을 올린다.

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

### /create-pr

브랜치 변경 사항을 분석해 PR 제목과 설명을 생성하고, 푸시한 뒤 PR을 만든다. PR 본문에는 변경된 흐름을 나타내는 mermaid 시퀀스 다이어그램이 항상 포함된다.

**사용법:**

```
/create-pr [options]
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

## java-team 플러그인

같은 마켓플레이스에 있는 별도 플러그인으로, Ten 개발3팀(JAVA팀) 공용 스킬을 담는다. 버전은 `ten-toolkit` 과 따로 관리한다.

```bash
/plugin marketplace add ten1010-io/ten-toolkit   # 이미 추가했다면 생략
/plugin install java-team@ten1010-io
```

**최신 상태 유지:** [최신 상태 유지](#최신-상태-유지) 참고. 서드파티 마켓은 자동 업데이트가 기본으로 꺼져 있고, `version` 을 올려야만 변경이 나간다.

### /java-team:meeting-prep

자바 회의의 본인 섹션을 준비한다. 실행한 요일·시간으로 회의를 정하고, 지난 회의 이후의 Jira 티켓, 본인이 고친 Confluence 문서, GitHub 커밋·PR·이슈, Slack 업무공유 스레드의 본인 댓글을 모아 보여주고, 사용자가 고른 항목만 회의 형식에 맞춰 정리한 뒤, 검토를 거쳐서만 Confluence 회의 페이지의 `### <이름>` 섹션에 반영한다.

| | 월요일 — 간단 공유 | 수요일 — 주간 업무 리뷰 |
|---|---|---|
| 실행 시점 | 월요일 | 화요일 오후 ~ 수요일 |
| 항목 | 번호 매긴 최상위 항목 5개, 하위 항목 없음 | 번호 매긴 항목 최대 5개, 중점 항목은 하위 항목 |
| 수집 범위 | 직전 회의 이후 | 직전 수요일 회의 이후 + 월요일 본인 섹션 (빼지 않음) |
| 정하는 것 | 굵직한 일 | 무엇을 중점으로 다룰지 (사용자와 함께) |
| 시각화 | — | 도움이 되면 표·다이어그램. 한 블록에 안 들어갈 만큼 크면 Artifact 로 만들어 링크 |

**사용법:**

```
/java-team:meeting-prep
```

"회의 준비해줘", "스크럼 준비해줘" 처럼 말해도 된다. 실행한 요일·시간으로 어느 회의인지 스스로 정하고, 판단이 안 서면 묻는다.

**예시 — 처음 실행할 때:**

```
> /java-team:meeting-prep

월요일 10:04 — 월요일 간단 공유로 준비합니다.
처음 실행이라 두 가지만 묻습니다. 최근 회의 페이지 링크와
업무 공유 Slack 채널 (쓰지 않으면 건너뛰어도 됩니다).

> https://your-site.atlassian.net/wiki/spaces/XX/pages/123456/2026+10+23+43
> #team-work-share

meeting-prep.json 에 저장했습니다. 다음부터는 묻지 않습니다.

지난 회의(10/23) 이후 확인된 작업입니다.

Jira
 1. ABC-3477 알림 임계값 편집 — Done
 2. ABC-3561 백엔드 wiki — To Do
GitHub PR
 3. backend #742 긴급 등급 이름 변경 — merged
 4. web #1787 Alert 화면 간격·배지 색 정리 — merged
Slack 업무공유 댓글
 5. 10/24 5.2.0 QA

[선택]  공유할 항목을 고르세요  →  1+3+4 와 5 를 고름

검토 부탁드립니다.

### <본인 이름>
1. 관리자가 화면에서 알림 임계값을 고칠 수 있게 됨 ([완료](https://your-site.atlassian.net/browse/ABC-3477))
2. 5.2.0 을 내보내기 전 전체 기능 점검 (진행 중)

이대로 괜찮으면 회의 페이지의 `### <본인 이름>` 섹션만 교체합니다.
다른 팀원 영역은 한 글자도 건드리지 않습니다.
```

페이지 본문에는 티켓 번호를 글자로 쓰지 않는다. 항목마다 **완료 / 진행 중 / 할 예정** 상태가 붙고, 그 상태 글자에 티켓 링크가 걸린다.

**사전 요구사항:** Atlassian(Jira/Confluence) 커넥터, [GitHub CLI](https://cli.github.com/). Slack 커넥터는 선택.

**처음 실행:** 최근 회의 페이지 링크와 Slack 업무 공유 채널을 한 번 묻고, 플러그인 데이터 디렉토리(`~/.claude/plugins/data/…`, 업데이트해도 유지)의 `meeting-prep.json` 에 저장한다. 바꾸려면 "회의 설정 다시 해줘"라고 말한다.

**변경 배포:** `plugins/java-team/.claude-plugin/plugin.json` 의 `version` 을 올리고 (`marketplace.json` 에는 버전을 적지 않는다) 두 README 최상단의 버전 표도 함께 갱신한다. 버전 문자열이 바뀌기 전까지 팀원은 새 커밋을 받지 않는다.

---

## 구조

```
ten-toolkit/
├── .claude-plugin/
│   ├── plugin.json        # 플러그인 메타데이터
│   └── marketplace.json   # 마켓플레이스 카탈로그
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
        │   └── plugin.json    # java-team 플러그인 메타데이터 (버전)
        └── skills/
            └── meeting-prep/
                └── SKILL.md
```

## 라이선스

MIT
