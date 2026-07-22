# 크롬 팻 (Chrome Pet)

웹페이지 위에서 살아 움직이는 팻을 키우는 크롬 확장(Manifest V3). 팻은 페이지 위를 뛰어다니고, 버튼·이미지 같은 요소 위에 올라앉으며, 배고픔·행복도에 따라 표정이 바뀐다.

> 순수 로직(`src/core/`)과 크롬 API(`src/chrome/`, `src/content/`, …)를 분리해, 모든 변경을 `npm run check` 한 줄로 검증할 수 있도록 만든 **하네스 기반** 프로젝트다.

---

## 기능

- **데스크톱 팻** — 모든 웹페이지 위에 오버레이로 떠서 중력으로 떨어지고 바닥을 뛰어다닌다.
- **드래그 이동** — 팻을 마우스로 잡아(누른 채) 끌어 옮길 수 있고, 놓으면 그 자리에서 떨어진다. (팻 스프라이트 영역만 클릭을 받고, 그 밖의 페이지 클릭은 막지 않는다.)
- **요소에 올라타기** — 화면에 보이는 버튼·링크·이미지 등(40~400px)으로 걸어가 그 위에 올라앉고, 요소가 스크롤로 사라지거나 제거되면 떨어진다.
- **상태 표정·동작** — 걸을 땐 달리기 애니메이션(walk1↔walk2), 멈췄을 때 상태별로 바뀐다.
  - 배고픔 ≥70 → 배고픈 얼굴, 행복 ≤30 → 놀아달라 칭얼(want_play), 행복 ≥90 → 활짝 웃음.
  - 주기적으로 잠깐 낮잠(sleep). 먹이를 주면(배고픔↓) 잠시 먹는 동작(eat) 재생.
- **먹이 주기** — 사이드패널의 "먹이 주기" 버튼으로 배고픔↓·행복↑.
- **시간 경과** — `chrome.alarms`(1분 주기)로 시간이 지나면 배고픔이 오르고 행복이 내린다.
- 팻 상태의 단일 진실 공급원은 `chrome.storage.local`.

---

## 요구 사항

- Node.js 18+ (개발 검증은 v22 기준)
- 크롬(또는 크로미움 계열) 브라우저

---

## 빌드

```bash
npm install
npm run build      # dist/ 에 확장 산출물 생성
```

`dist/` 에 다음이 만들어진다.

```
dist/
├─ manifest.json
├─ background.js     # service worker
├─ content.js        # 페이지 오버레이 + 알림 프록시
├─ sidepanel.html / sidepanel.js
└─ pet.png           # 스프라이트 시트(6프레임)
```

---

## 크롬에서 실행하는 법 (상세)

### 1. 확장 로드

1. 크롬 주소창에 `chrome://extensions` 를 연다.
2. 오른쪽 위 **개발자 모드**를 켠다.
3. **압축해제된 확장 프로그램을 로드** 버튼을 누른다.
4. 이 저장소의 **`dist` 폴더**를 선택한다. (예: `.../chrome-pet/dist`)
5. 목록에 "크롬 팻"이 나타나면 로드 완료.

### 2. 팻 보기 (웹페이지 오버레이)

- 아무 웹페이지나 **새로 열거나 새로고침**한다. 상단에서 팻이 떨어져 바닥을 뛰어다니고, 근처 버튼·이미지 위로 올라앉는다.
- 이미 열려 있던 탭에는 주입되지 않으니 **새로고침(F5)** 해야 나타난다.

### 3. 사이드패널 열기 (먹이 주기 버튼)

- 툴바의 **확장 아이콘("크롬 팻")을 클릭**하면 사이드패널이 열린다. (아이콘이 안 보이면 퍼즐 아이콘에서 "크롬 팻"을 고정한다.)
- 패널에 팻의 배고픔·행복 수치와 **먹이 주기** 버튼이 보인다.
- 아이콘 클릭으로 안 열리면 크롬 툴바의 **사이드 패널 아이콘**에서 "크롬 팻"을 골라도 된다.

### 4. 코드를 고친 뒤 반영

```bash
npm run build
```
그다음 `chrome://extensions` 에서 확장의 **새로고침(↻)** 버튼을 누르고, 확인할 웹페이지를 새로고침한다.

### 5. 동작이 잘 보이지 않을 때 (중요)

기본 감쇠 속도가 느려서(시간당 배고픔 +10) 그냥 두면 표정 변화가 잘 안 보인다. 개발자 도구로 상태를 주입해 바로 확인할 수 있다.

- 사이드패널에서 **우클릭 → 검사(Inspect) → Console** 에 입력.
  ```js
  // 배고픈 상태로 만들기 → 사이드패널 새로고침 후 "먹이 주기" 누르면 수치 변화가 보인다
  chrome.storage.local.set({ pet: { hunger: 80, happiness: 40, lastUpdated: Date.now() } })
  ```
- 시간 경과(감쇠)를 즉시 보려면 `lastUpdated` 를 과거로 조작한다. 다음 알람(≤1분)에 배고픔이 확 뛴다.
  ```js
  chrome.storage.local.set({ pet: { hunger: 0, happiness: 100, lastUpdated: Date.now() - 3*3600000 } })
  ```

### 6. 상태·에러 확인

- **service worker 로그**: `chrome://extensions` → 크롬 팻 → "서비스 워커" 링크 → Console.
- **전역 에러 기록**: service worker Console 에서
  ```js
  chrome.storage.local.get('__errors').then(console.log)   // 빈 배열이면 정상
  ```

---

## 검증 (개발)

| 명령어 | 역할 |
|---|---|
| `npm run lint` | eslint (core/ 에서 `chrome.*` 사용 금지 규칙 포함) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | vitest 단위 테스트(순수 로직) |
| `npm run validate` | manifest.json MV3 스키마 검증 |
| `npm run build` | esbuild 번들 + 스프라이트 복사 → `dist/` |
| `npm run check` | 위 전체를 순서대로 실행 (완료 게이트) |
| `npm run test:e2e` | Playwright로 실제 크롬에 확장을 로드해 검증 |

E2E는 headed 크롬이 필요하다.
```bash
npx playwright install chromium   # 최초 1회
npm run build && npm run test:e2e
```

---

## 프로젝트 구조

```
src/
├─ core/          # 크롬 API 의존 없는 순수 로직 (vitest로 검증)
│   ├─ petState.ts     # 배고픔·행복 상태머신 (decay, feed)
│   └─ petBehavior.ts  # 팻 물리·행동 (중력·걷기·요소 안착·프레임 선택)
├─ chrome/        # 크롬 API 어댑터 (얇게)
│   └─ storage.ts
├─ background/    # service worker (알람 → 감쇠, 전역 에러 기록)
├─ content/       # 페이지 오버레이 + rAF 렌더 + 알림 프록시
└─ sidepanel/     # 팻 상태 표시 + 먹이 주기 버튼
scripts/          # build / validate / make-sprite
tests/e2e/        # Playwright E2E (smoke·feed·alarm·overlay·perch)
```

---

## 스프라이트 교체

스프라이트 시트(`src/assets/pet.png`)는 9프레임(idle·walk1·walk2·fall·happy·hungry·want_play·sleep·eat)이며, 각 64×104px다. 원본 프레임 이미지에서 다시 만들려면.

```bash
node scripts/make-sprite.mjs   # assets/frames/ 의 원본 → src/assets/pet.png
```

배경이 있는 이미지는 테두리 flood-fill로 투명화하고, 이미 투명한 이미지는 알파를 그대로 사용한다. 6프레임을 가로 갭 기준으로 자동 분리한다.

---

## 튜닝 값 (`src/core/petBehavior.ts`)

| 상수 | 기본값 | 의미 |
|---|---|---|
| `WALK_SPEED` | 60 | 이동 속도 (px/s) |
| `WALK_STRIDE` | 14 | 걷기 프레임 교대 보폭 (작을수록 발놀림 빠름) |
| `WALK_MS` / `IDLE_MS` | 2500 / 1200 | 걷는 시간 / 멈추는 시간 (ms) |
| `SPRITE_W` / `SPRITE_H` | 64 / 104 | 스프라이트 프레임 크기 |
| `G` / `CLIMB_SPEED` | 2000 / 120 | 중력 / 요소 오를 때 상승 속도 |

---

## 제약 (MV3)

- service worker는 유휴 30초 후 종료된다 → 주기 작업은 `setInterval` 대신 `chrome.alarms`.
- 알림 감지는 content script의 `window.Notification` 프록시로만 가능하다(OS·타 확장 알림 불가).
- 팻 위치는 탭/페이지별 휘발성이며, 배고픔·행복만 `chrome.storage.local`에 저장된다.
