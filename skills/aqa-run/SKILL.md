---
name: aqa-run
description: Run YAML-based QA test scenarios via browser-use CLI and generate HTML reports with screenshots. AI-driven browser automation that reads scenarios, executes steps, and produces summary.json + report.html.
---

# AQA Run - AI QA Automation Scenario Runner

YAML 시나리오 파일을 읽고 browser-use CLI로 실행한 뒤, HTML 리포트와 summary.json을 생성하는 스킬.

## Trigger

Use when the user wants to run QA test scenarios, execute browser automation tests, or asks to run YAML scenario files from the aipub-aqa project.

## Arguments

- `<scenario_path>` — YAML 시나리오 파일 경로 (필수). 단일 파일 또는 디렉토리.
  - 예: `scenarios/auth/login_success.yaml`
  - 예: `scenarios/auth/` (디렉토리면 하위 YAML 전부 실행)
- `--headed` — 브라우저 창을 띄워서 실행 (기본: headed)
- `--headless` — 헤드리스 모드로 실행

## Workflow

아래 절차를 **정확히** 따르세요.

### 0. 의존성 체크

시작 전에 `browser-use` CLI 스킬이 설치되어 있는지 확인합니다.

```bash
browser-use --help
```

- 정상 출력이 나오면 → 다음 단계로 진행
- `command not found` 또는 에러 발생 시 → 아래 메시지를 출력하고 **즉시 중단**합니다:

```
[ERROR] browser-use CLI가 설치되어 있지 않습니다.
아래 명령어로 먼저 설치해 주세요:

  npx skills add anthropic/browser-use

또는 pip으로 설치:

  pip install browser-use

설치 후 다시 실행해 주세요.
```

### 1. YAML 시나리오 파싱

YAML 파일을 Read 도구로 읽고 아래 구조를 파악합니다:

```yaml
name: "시나리오 이름"
description: "설명"                    # 선택
priority: critical|high|medium|low    # 선택
tags: [tag1, tag2]                    # 선택
test_data:                            # 변수 치환용
  BASE_URL: "https://example.com"     # URL도 여기에 포함
  username: "값"
  password: "값"
depends_on: []                        # 선택

steps:
  - action: "자연어로 행동 설명"       # 필수 — 이 필드 하나로 모든 행동을 기술

cleanup:                              # 선택
  - type: clear_cookies
```

**변수 치환 규칙:**

`test_data`의 모든 키-값 쌍이 `${키}` 형태로 action 문자열에서 치환됩니다.
- `${BASE_URL}` → test_data.BASE_URL 값
- `${username}` → test_data.username 값
- `${password}` → test_data.password 값

`test_data`에 `BASE_URL`이 없고, `.env` 또는 `.env.example`에 `TARGET_BASE_URL`이 있으면 이를 `${BASE_URL}`로 사용합니다. 둘 다 없으면 사용자에게 물어봅니다.

**`action` 필드 작성 규칙:**

`action`은 자연어 문장으로, Claude가 이를 읽고 적절한 browser-use 명령어를 판단합니다. 변수(`${...}`)를 포함할 수 있습니다.

예시:
- `"${BASE_URL}/welcome 페이지로 이동"` → `browser-use open ...`
- `"아이디 입력란에 ${username} 입력"` → `browser-use state` → `browser-use input {index} "..."`
- `"Sign in 버튼 클릭"` → `browser-use state` → `browser-use click {index}`
- `"Dashboard 텍스트가 보이는지 확인"` → `browser-use state`로 텍스트 존재 여부 검증
- `"URL에 /main 이 포함되어 있는지 확인"` → `browser-use state`의 URL 확인

**변수 치환 규칙:**
- `${BASE_URL}` → 위 1단계에서 결정된 base_url 값
- `${username}`, `${password}` 등 → test_data의 해당 키 값

### 3. 리포트 디렉토리 생성

```
reports/{YYYY-MM-DD_HH-MM-SS}/
  artifacts/{scenario_name}/    ← 스크린샷 저장
  summary.json
  report.html
```

- `scenario_name`은 공백을 `_`로 치환합니다.
- Bash 도구로 `mkdir -p`를 실행합니다.

### 4. 시나리오 실행

각 시나리오에 대해 아래를 수행합니다.

#### 4-1. 브라우저 열기

첫 번째 step의 action에서 URL을 파악하여 브라우저를 엽니다.

```bash
browser-use --headed open "{URL}"
```

`--headless` 옵션이 지정된 경우 `--headed` 대신 생략합니다.

#### 4-2. SSL 인증서 경고 처리

`browser-use state` 결과에 "연결이 비공개로 설정되어 있지 않습니다" 또는 "ERR_CERT" 가 포함되면:
1. "고급" 또는 "details" 버튼 클릭
2. "안전하지 않음으로 이동" 또는 "proceed" 링크 클릭
3. 다시 `browser-use state`로 정상 페이지 확인

#### 4-3. 각 step 실행

각 step마다 아래를 수행합니다:

1. **시작 시간 기록** (Bash로 `date +%s%3N`)

2. **Before 스크린샷 저장**
   ```bash
   browser-use screenshot reports/{timestamp}/artifacts/{scenario_name}/step_{NN}_before.png
   ```

3. **action 해석 및 실행**

   `action` 문자열을 읽고, 자연어 의미를 파악하여 적절한 browser-use 명령어를 실행합니다:

   - **이동** (action에 URL이나 "이동", "접속", "navigate" 포함):
     → `browser-use open "{URL}"`

   - **입력** (action에 "입력", "type", "enter" 포함):
     → `browser-use state`로 요소 확인 → `browser-use input {index} "{값}"`

   - **클릭** (action에 "클릭", "click", "누르" 포함):
     → `browser-use state`로 요소 확인 → `browser-use click {index}`

   - **확인/검증** (action에 "확인", "보이는지", "검증", "verify", "assert" 포함):
     → `browser-use state`에서 텍스트/URL/요소 존재 여부 확인
     → 없으면 `browser-use eval "document.body.innerText"`로 재확인
     → 결과를 assertion으로 기록 (pass/fail)

   - **그 외**: action 문맥을 최대한 해석하여 적절한 browser-use 명령어 조합으로 실행

   **핵심 원칙:** 항상 `browser-use state`로 현재 화면 상태를 먼저 확인한 뒤, action 설명에 가장 부합하는 요소를 선택하여 조작합니다.

4. **After 스크린샷 저장**
   ```bash
   browser-use screenshot reports/{timestamp}/artifacts/{scenario_name}/step_{NN}_after.png
   ```

5. **action에 검증이 포함된 경우** 결과를 assertions 배열에 기록합니다.

6. **종료 시간 기록** → duration_ms 계산

7. **step 결과 기록:**
   - `index`: step 번호 (1부터)
   - `action`: step의 action 텍스트
   - `status`: "pass" | "fail" | "error"
   - `method`: "claude-browser-use"
   - `locator`: 실제 사용한 browser-use 명령어
   - `assertions`: 검증 결과 배열
   - `error`: 에러 메시지 (없으면 null)
   - `duration_ms`: 소요 시간
   - `screenshots.before`: before 스크린샷 상대 경로
   - `screenshots.after`: after 스크린샷 상대 경로

#### 4-4. 클린업

시나리오 실행 후:
```bash
browser-use cookies clear
browser-use close
```

### 5. summary.json 생성

아래 포맷으로 Write 도구를 사용하여 저장합니다:

```json
{
  "executed_at": "{timestamp}",
  "mode": "claude-browser-use",
  "total": 1,
  "passed": 1,
  "failed": 0,
  "errors": 0,
  "scenarios": [
    {
      "name": "시나리오 이름",
      "status": "pass|fail|error",
      "duration_ms": 12345,
      "steps": [
        {
          "index": 1,
          "action": "행동 설명",
          "status": "pass|fail|error",
          "method": "claude-browser-use",
          "locator": "browser-use input 5 'aipubadmin'",
          "assertions": [
            {
              "type": "url_contains",
              "expected": "/welcome",
              "actual": "https://..../welcome",
              "passed": true
            }
          ],
          "error": null,
          "duration_ms": 1234,
          "screenshots": {
            "before": "reports/.../step_01_before.png",
            "after": "reports/.../step_01_after.png"
          }
        }
      ]
    }
  ]
}
```

### 6. HTML 리포트 생성

아래 HTML 템플릿을 사용하여 `report.html`을 Write 도구로 생성합니다.
스크린샷은 base64로 인라인 임베딩합니다 (Bash로 `base64 -i {path}` 실행하여 획득).

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>AI QA Report (Claude Code) - {executed_at}</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f3f4f6; }
    code { background: #e5e7eb; padding: 1px 4px; border-radius: 3px; font-size: 11px; word-break: break-all; }
    .summary-cards { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .card { padding: 16px 24px; border-radius: 12px; border: 1px solid #e5e7eb; text-align: center; min-width: 100px; }
    .card-value { font-size: 32px; font-weight: bold; }
    .card-label { color: #666; font-size: 13px; }
    .card-total { background: #fff; }
    .card-pass { background: #f0fdf4; border-color: #bbf7d0; }
    .card-pass .card-value { color: #22c55e; }
    .card-fail { background: #fef2f2; border-color: #fecaca; }
    .card-fail .card-value { color: #ef4444; }
    .card-error { background: #fff7ed; border-color: #fed7aa; }
    .card-error .card-value { color: #f97316; }
    .card-rate { background: #fff; }
    .scenario { border: 1px solid #d1d5db; border-radius: 12px; padding: 16px; margin: 16px 0; background: #fafafa; }
    .scenario-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .badge { color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .badge-pass { background: #22c55e; }
    .badge-fail { background: #ef4444; }
    .badge-error { background: #f97316; }
    .step { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin: 8px 0; background: #fff; }
    .step-header { display: flex; justify-content: space-between; align-items: center; }
    .step-action { margin-top: 4px; color: #1d4ed8; font-size: 13px; }
    .step-meta { font-size: 12px; color: #666; }
    .step-error { color: #ef4444; font-size: 13px; margin-top: 4px; }
    .assertion-pass { color: #166534; font-size: 12px; }
    .assertion-fail { color: #991b1b; font-size: 12px; }
    .screenshot { max-width: 500px; border: 1px solid #ddd; border-radius: 4px; margin-top: 8px; }
    .screenshots { display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
    .screenshot-label { font-size: 11px; color: #999; margin-bottom: 2px; }
</style>
</head>
<body>
    <h1>AI QA Report <span style="font-size:16px;color:#666">(Claude Code + browser-use)</span></h1>
    <div style="color:#666;margin-bottom:20px">{executed_at}</div>

    <!-- Summary Cards -->
    <div class="summary-cards">
        <div class="card card-total"><div class="card-value">{total}</div><div class="card-label">Total</div></div>
        <div class="card card-pass"><div class="card-value">{passed}</div><div class="card-label">Passed</div></div>
        <div class="card card-fail"><div class="card-value">{failed}</div><div class="card-label">Failed</div></div>
        <div class="card card-error"><div class="card-value">{errors}</div><div class="card-label">Errors</div></div>
        <div class="card card-rate"><div class="card-value">{pass_rate}%</div><div class="card-label">Pass Rate</div></div>
    </div>

    <!-- Scenarios: 각 시나리오별로 아래 블록을 반복 -->
    <div class="scenario">
        <div class="scenario-header">
            <h3>{scenario_name} <span class="badge badge-{status}">{STATUS}</span></h3>
            <span class="step-meta">{step_count} steps | {duration_ms}ms</span>
        </div>

        <!-- Steps: 각 step별로 반복 -->
        <div class="step">
            <div class="step-header">
                <b>Step {index}</b>
                <span class="step-meta">{duration_ms}ms</span>
            </div>
            <div class="step-action">{action}</div>
            <div class="step-meta"><code>{locator}</code></div>

            <!-- assertions 결과 -->
            <div class="assertion-pass">PASS: {type} — expected: {expected}, actual: {actual}</div>
            <!-- 또는 -->
            <div class="assertion-fail">FAIL: {type} — expected: {expected}, actual: {actual}</div>

            <!-- 에러가 있으면 -->
            <div class="step-error">Error: {error_message}</div>

            <!-- 스크린샷 (base64 인라인) -->
            <div class="screenshots">
                <div>
                    <div class="screenshot-label">Before</div>
                    <img class="screenshot" src="data:image/png;base64,{base64_data}">
                </div>
                <div>
                    <div class="screenshot-label">After</div>
                    <img class="screenshot" src="data:image/png;base64,{base64_data}">
                </div>
            </div>
        </div>
        <!-- /Steps -->
    </div>
    <!-- /Scenarios -->

    <div style="text-align:center;color:#999;font-size:12px;margin-top:40px;padding:20px">
        Generated by AI QA Automation (Claude Code + browser-use) | aipub-aqa
    </div>
</body>
</html>
```

### 7. 결과 출력

실행 완료 후 아래 형식으로 결과를 출력합니다:

```
====================================
총 {total}건 | 통과 {passed}건 | 실패 {failed}건 | 오류 {errors}건
리포트: reports/{timestamp}/report.html
====================================
```

## 주의사항

- `locator_hint`는 **무시**합니다. 항상 `browser-use state`로 화면 요소를 직접 확인하여 적절한 인덱스를 찾습니다.
- `sensitive: true`인 step의 input 값은 결과 출력 시 `****`로 마스킹합니다.
- SSL 인증서 경고는 자동으로 우회합니다.
- 각 step 실행 시 `browser-use state`의 요소 목록을 보고 action 설명에 가장 부합하는 요소를 선택합니다. 이것이 이 스킬의 핵심 — AI가 화면을 보고 판단합니다.
- 디렉토리가 인자로 주어지면 해당 디렉토리의 모든 `.yaml` 파일을 순서대로 실행합니다.
- 시나리오 간 `depends_on`이 있으면 의존 시나리오를 먼저 실행합니다.
- Python 3.14 호환 문제로 `browser-use` CLI를 직접 실행할 수 없는 경우, 아래 래퍼를 사용합니다:
  ```bash
  PYTHONDONTWRITEBYTECODE=1 uv run python -c "
  import asyncio, sys
  _orig = asyncio.get_event_loop
  def _patched():
      try: return _orig()
      except RuntimeError:
          loop = asyncio.new_event_loop()
          asyncio.set_event_loop(loop)
          return loop
  asyncio.get_event_loop = _patched
  sys.argv = ['browser-use', {실제 인자들}]
  from browser_use.skill_cli.main import main
  main()
  " 2>&1
  ```
  먼저 `browser-use` 직접 실행을 시도하고, `RuntimeError`나 `command not found`가 발생하면 위 래퍼로 전환합니다.
