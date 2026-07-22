# CLAUDE.md — 크롬 팻 확장(Pet Extension) 개발 지침

이 문서는 Claude Code가 이 저장소에서 작업할 때 따라야 할 규칙이다.
목표: **사람 개입 없이 에이전트 스스로 검증 가능한 상태(하네스)** 를 유지하고,
**작게 수정 → 즉시 검증 → 통과 시 다음 단계(루프)** 로만 진행한다.

---

## 1. 하네스 엔지니어링 (Harness Engineering)

> 원칙: "에이전트가 스스로 정답을 확인할 수 없는 작업은 시키지 않는다."
> 모든 기능은 명령어 한 줄로 검증 가능해야 한다.

### 1.1 필수 검증 명령어 (없으면 먼저 만들 것)

| 명령어 | 역할 | 도구 |
|---|---|---|
| `npm run lint` | 문법·스타일 검사 | eslint |
| `npm run typecheck` | 타입 검사 | tsc --noEmit |
| `npm run test` | 팻 상태머신 단위 테스트 | vitest |
| `npm run test:e2e` | 확장 로드 후 실제 동작 검증 | playwright (chromium) |
| `npm run validate` | manifest.json 스키마 검증 | 자체 스크립트 |
| `npm run check` | 위 전체를 순서대로 실행 | 종합 게이트 |

**작업 완료 선언 전 `npm run check` 통과는 필수다. 통과 못 하면 완료가 아니다.**

### 1.2 E2E 하네스: 확장을 실제로 띄워서 확인한다

크롬 확장은 코드만 봐서는 동작을 보장할 수 없다. Playwright로 unpacked 확장을 로드해 검증한다.

```ts
// tests/e2e/harness.ts — 모든 E2E 테스트의 진입점
import { chromium, type BrowserContext } from '@playwright/test';
import path from 'path';

export async function launchWithExtension(): Promise<BrowserContext> {
  const extPath = path.resolve(__dirname, '../../dist');
  return chromium.launchPersistentContext('', {
    headless: false, // MV3 확장은 headless 제약 있음. CI에서는 xvfb 사용
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
    ],
  });
}
```

E2E에서 반드시 확인할 것:
1. service worker가 에러 없이 기동되는가 (`context.serviceWorkers()`)
2. side panel이 열리고 팻이 렌더링되는가
3. **콘솔 에러가 0건인가** — `page.on('console')`로 error 수집, 1건이라도 있으면 실패 처리
4. `chrome.storage`에 팻 상태가 저장/복원되는가

### 1.3 순수 로직과 크롬 API를 분리한다 (테스트 가능성 확보)

```
src/
├─ core/            # 크롬 API 의존 없음 → vitest로 빠르게 테스트
│   ├─ petState.ts  # 배고픔·행복도 상태머신 (순수 함수)
│   └─ scheduler.ts # 시간 경과 계산 (Date 주입받아 테스트 가능)
├─ chrome/          # 크롬 API 어댑터 (얇게 유지, E2E로만 검증)
│   ├─ storage.ts
│   └─ alarms.ts
├─ background/      # service worker
├─ sidepanel/       # 팻 UI
└─ content/         # Notification 가로채기
```

규칙:
- `core/`에는 `chrome.*` 호출 금지. 위반 시 eslint 커스텀 룰로 잡는다.
- 시간·랜덤은 항상 인자로 주입한다 (`decay(state, now: number)`). 테스트 재현성 확보.

### 1.4 실패를 빨리, 크게 드러낸다

- service worker에서 `self.addEventListener('error', ...)`로 전역 에러를 `chrome.storage.local`의 `__errors` 키에 기록한다. E2E가 이 키를 읽어 에러 유무를 판정한다.
- `console.error`는 삼키지 않는다. 조용한 실패가 가장 비싸다.

---

## 2. 루프 엔지니어링 (Loop Engineering)

> 원칙: "한 루프 = 하나의 검증 가능한 변경." 루프가 끝날 때마다 저장소는 항상 동작하는 상태여야 한다.

### 2.1 기본 작업 루프

```
① 계획: 이번 루프에서 바꿀 것 1가지를 문장으로 선언
② 실패하는 테스트를 먼저 작성 (가능한 경우)
③ 최소 구현
④ npm run check 실행
⑤ 실패 → 로그 읽고 수정 → ④로 (최대 5회)
⑥ 통과 → git commit → 다음 루프
```

루프 규칙:
- **한 루프에서 파일 5개 / 200줄 이상 수정 금지.** 넘으면 루프를 쪼갠다.
- ⑤에서 5회 실패하면 멈추고, 원인 분석과 대안 2가지를 사용자에게 보고한다. 무한 시도 금지.
- 검증 없이 "됐을 것이다"라고 판단하지 않는다. 추측은 루프가 아니다.

### 2.2 커밋 = 루프의 종료 신호

- 커밋 메시지: `feat(pet): 배고픔 감소 알람 추가 — check 통과`
- `npm run check` 미통과 상태로 커밋 금지.
- 되돌리기 쉬운 작은 커밋이 큰 커밋 1개보다 항상 낫다.

### 2.3 훅으로 루프를 자동 강제한다

`.claude/settings.json`에 등록해 사람이 아니라 시스템이 루프를 강제하게 한다:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "npm run lint --silent && npm run typecheck --silent" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "npm run check" }
        ]
      }
    ]
  }
}
```

- `PostToolUse`: 파일을 고칠 때마다 lint+typecheck가 즉시 돌아 빠른 피드백을 준다.
- `Stop`: 작업을 끝내려 할 때 전체 게이트가 통과해야만 종료된다.

### 2.4 탐색 루프와 구현 루프를 분리한다

- **탐색 루프**: 코드 수정 없이 읽기만. "MV3에서 alarms 최소 주기 확인" 같은 조사. 결과는 `docs/notes/`에 메모로 남긴다.
- **구현 루프**: 2.1의 루프. 탐색 결과가 확정된 뒤에만 시작한다.
- 둘을 섞으면 "조사하다가 반쯤 고친" 깨진 상태가 생긴다. 금지.

### 2.5 루프가 막힐 때의 규칙

1. 같은 에러로 2회 실패 → 접근을 바꾼다 (같은 수정 반복 금지)
2. 에러 메시지를 그대로 검색/분석하고, 재현 최소 케이스를 먼저 만든다
3. 원인을 모른 채 코드를 "일단 바꿔보기" 금지 — 로그·상태를 먼저 확보한다
4. 하네스 자체가 부족해서 검증이 안 되면, **기능 구현을 멈추고 하네스부터 보강한다**

---

## 3. 프로젝트 고정 제약 (팻 확장 도메인 지식)

- Manifest V3. service worker는 유휴 30초 후 종료된다 → 상태 변화는 `setInterval` 금지, `chrome.alarms`(최소 주기 30초) 사용.
- 팻 상태의 단일 진실 공급원은 `chrome.storage.local`. 메모리 변수에 의존하지 않는다.
- 알림 감지는 content script에서 `window.Notification`을 프록시로 감싸 SW로 메시지 전달. OS/타 확장 알림은 접근 불가 — 시도하지 않는다.
- side panel UI는 프레임워크 없이 vanilla TS + CSS로 가볍게 유지한다.

## 4. 완료 정의 (Definition of Done)

아래 전부를 만족해야 "완료"다:

- [ ] `npm run check` 통과
- [ ] E2E에서 콘솔 에러 0건
- [ ] 새 로직은 `core/`에 있고 단위 테스트가 존재
- [ ] 커밋 완료, 커밋 메시지에 검증 결과 명시
- [ ] 하네스로 검증 불가능한 변경이었다면, 그 사실과 수동 확인 방법을 보고

## 5. 하네스: 크롬 팻 확장 개발 (에이전트 팀)

**목표:** core↔크롬↔UI 를 분리해 각 변경을 `npm run check`/E2E 로 스스로 검증하는 3인 팀 개발 체계.

**트리거:** 팻 기능 추가·수정·버그 수정·리팩터링 요청 시 `pet-loop-orchestrator` 스킬을 사용하라. 단순 질문은 직접 응답 가능.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-07-22 | 초기 구성 (검증 하네스 부트스트랩 + 3인 팀) | 전체 | - |
