# HANDOFF — 크롬 팻 확장

다음 세션(사람/에이전트)이 이어받기 위한 인수인계 문서. 작성 2026-07-23, 갱신 2026-08-06.

## 1. 현재 상태 (한 줄)

MV3 크롬 확장. 웹페이지 위 데스크톱 팻(오버레이) + 사이드패널 상태 UI. `npm run check` 그린(유닛 85 + E2E 10), `origin/main`과 완전 동기화(HEAD `5120a0b`). GitHub: `jjang750/chrome-pet`.

## 2. 구현된 기능

- **데스크톱 팻** — 모든 웹페이지 오버레이. 중력 낙하 → 바닥 배회. 9프레임 스프라이트 애니메이션.
- **프레임 규칙** — 좌우로 움직이면(vel.x≠0) walk1↔walk2, 멈추면 상태별 액션. 우선순위: falling>held>eating>playing>walk>hungry>sleep>want_play>happy>idle.
- **요소 안착(perch)** — 보이는 적당한 크기 요소 전반(div·카드·문단·목록·헤딩·버튼 등)으로 걸어가 올라앉음. 6초 체류 후 내려와 다른 요소로 이동. 거대 래퍼/안 보이는 요소 제외.
- **드래그** — 마우스로 팻을 잡아(held) 끌고, 놓으면 낙하.
- **먹이 주기** — 사이드패널 버튼 → `fedAt` 신호 → content가 2초 eat 애니메이션(배부른 팻도 반응).
- **배고픔 알람** — `chrome.alarms` 1분 주기로 decay(시간 경과 시 배고픔↑·행복↓). **배고픔·행복을 바꾸는 경로는 decay(시간)와 feed(사용자) 둘뿐이다** — 결정 10 참고.
- **추가 애니메이션** — 주기적 낮잠(sleep, 10초 유지), 행복 낮으면 칭얼(want_play), 행복 높으면 happy. 낮잠은 **연출 전용**으로 상태 보상이 없다.
- **마우스 놀이** — 마우스 30초 정지 + 커서가 뷰포트 안이면 커서로 올라가 놀기(playing, happy 프레임). 마우스 이동/커서 이탈 시 해제.
- **사이드패널** — 아이콘 클릭으로 열림(`setPanelBehavior`). 배고픔·행복 게이지 바 + 숫자, storage 변경 실시간 반영.
- **컨텍스트 무효화 자기 정리** — 확장 리로드/업데이트로 content script 컨텍스트가 죽으면 rAF 루프를 멈추고 오버레이를 제거한다(`isExtensionContextValid`). 리로드 후 유령 팻과 `Extension context invalidated` 에러 스팸을 끊는다.

## 3. 아키텍처 (core/chrome 분리)

```
src/
├─ core/            # 순수 로직 (크롬 API 없음, vitest로 빠르게 검증)
│   ├─ petState.ts     # 배고픔·행복 상태머신 (createPet, decay, feed)
│   └─ petBehavior.ts  # 물리·행동 상태머신 (step, spriteFrame) + 모든 튜닝 상수
├─ chrome/
│   ├─ storage.ts     # chrome.storage 어댑터 (loadPet/savePet)
│   └─ context.ts     # isExtensionContextValid — 죽은 확장 컨텍스트 판정
├─ background/index.ts# service worker (알람 생성·decay, setPanelBehavior, 전역 에러 → __errors)
├─ content/index.ts   # 오버레이 rAF 렌더 + 요소 타깃팅 + 드래그·먹이·놀이 트리거 + 알림 프록시 + 컨텍스트 정리
└─ sidepanel/         # 상태 게이지 UI + 먹이 버튼
scripts/  build.mjs · validate-manifest.mjs · make-sprite.mjs
tests/e2e/ smoke·feed·alarm·overlay·perch·perch-hop·drag·eat·context-invalidation·sleep-no-recovery.spec.ts
```

- **규칙**: `core/`엔 `chrome.*`·`Date.now()`·`Math.random()` 금지(eslint가 chrome 전역 차단). 시간·랜덤은 인자 주입. 위치는 페이지별 휘발성(메모리), 배고픔·행복만 `chrome.storage.local`에 저장.

## 4. 검증·빌드

| 명령 | 역할 |
|---|---|
| `npm run check` | lint→typecheck→test(vitest 85)→validate→build→**test:e2e(10)**. **완료 게이트, 이거 통과가 곧 완료.** 약 3분(E2E 2.4분) |
| `npm run build` | esbuild 번들 + `src/assets/pet.png` 복사 → `dist/` |
| `npm run test:e2e` | Playwright (headed chromium 필요, 최초 `npx playwright install chromium`) |

E2E는 2026-08-02에 `check` 안으로 편입됐다(결정 11). 게이트가 느려진 대가로 "유닛은 그린인데 확장이 깨진" 상태가 커밋되는 것을 막는다.

## 5. 크롬에서 실행

`npm run build` → `chrome://extensions` 개발자 모드 → `dist/` 로드 → **아이콘 클릭**으로 사이드패널, **아무 페이지 새로고침**하면 팻 등장. 코드 수정 후엔 build → 확장 새로고침(↻) → 페이지 새로고침. 상세는 `README.md`.

## 6. 튜닝 상수

**`src/core/petBehavior.ts`**: `SPRITE_W=64` `SPRITE_H=104` · `G=700`(중력) · `WALK_SPEED=32` · `WALK_STRIDE=14`(걷기 프레임 교대 보폭) · `CLIMB_SPEED=120` · `WALK_MS=5000`/`IDLE_MS=900`(걷기/멈춤 주기) · `SLEEP_EVERY=5`(낮잠 주기).

**`src/content/index.ts`**: `PERCH_MS=6000`(요소 체류) · `RETARGET_INTERVAL=4000` · `EAT_MS=2000` · `IDLE_MOUSE_MS=30000`(마우스 놀이) · `PLAY_LERP=0.15` · 후보 크기 필터(폭 40~400·높이 24~320).

## 7. 스프라이트 파이프라인

- 9프레임 순서(고정): `idle·walk1·walk2·fall·happy·hungry·want_play·sleep·eat`. 각 64×104px, 시트 576×104.
- `scripts/make-sprite.mjs`가 원본 시트를 읽어 `src/assets/pet.png` 생성. 기능: 배경 투명화(불투명 소스면 무채색 flood-fill, 이미 투명이면 알파 그대로), 프레임 분리(9 균등/갭), **주 캐릭터 기준 크기·바닥 정렬**(장식 잘림 방지), **좌우 반전**(`MIRROR_X=true` — 소스가 왼쪽 보기라 오른쪽 보기로 뒤집음).
- 현재 소스: `assets/frames/sprite_images_v8.png`. **새 아트 교체법**: `assets/frames/`에 넣고 make-sprite의 `SRC`만 바꿔 `node scripts/make-sprite.mjs` → `pet.png` 재생성 → 눈으로 확인 → `npm run check`.
- 아트 규칙: 가로 한 줄 9칸·균일·라벨 없음·진짜 알파 투명. 오른쪽 보기로 그려주면 `MIRROR_X=false`로 바꾸면 됨.

## 8. Git

- **chrome-pet은 자체 git 저장소**(홈 디렉토리 repo 아님). remote `origin` = github.com/jjang750/chrome-pet.git, 브랜치 `main`.
- **push**: 2026-08-06 확인 기준 `git push origin main`이 에이전트에서 직접 실행된다(7/23에 기록된 "안전 게이트에 막힘"은 현재 해당 없음). 막히면 사용자가 `! git push origin main` 실행.
- 기능 작업은 `fix/…`·`feat/…` 브랜치에서 하고, `npm run check` 그린 뒤 main에 ff 병합 → push 한다.
- 커밋은 pathspec으로 chrome-pet 파일만 스코프. 커밋 메시지에 검증 결과 명시, 끝에 Co-Authored-By 트레일러.
- **미커밋 잔여물**(의도적 제외): `assets/frames/`의 중간 아트(image-removebg-preview.png, sprite_images.png, v3, v5)와 루트 `dist.zip`/`dist.7z` — 정리 대상(불필요 시 삭제).

## 9. 에이전트 하네스 (개발 방식)

이 프로젝트는 3인 전문가 팀 + 오케스트레이터로 개발한다.
- **에이전트** `.claude/agents/`: `core-logic-dev`(순수 로직 TDD) · `chrome-adapter-dev`(크롬 API·SW·content·sidepanel) · `harness-qa`(검증 게이트·E2E·경계면).
- **스킬** `.claude/skills/`: `pet-loop-orchestrator`(루프 진입점) + core-tdd · chrome-adapter · harness-qa-verify.
- **루프**: 계획 → (실패 테스트) → 최소 구현 → `npm run check` → 커밋. core 변경은 core-logic-dev, 크롬 계층은 chrome-adapter-dev, 검증은 harness-qa.
- 팻 기능 요청 시 `pet-loop-orchestrator` 스킬이 트리거됨(CLAUDE.md 섹션 5 참고).

## 10. 알아둘 점 / 다음 후보

- **마우스 놀이**는 전용 프레임 없이 `happy`를 재사용 중 — "커서 툭툭 치는" 전용 포즈를 주면 교체 가능.
- **E2E 타이밍**: WALK_SPEED 감소로 perch류 스펙이 느려 timeout을 넉넉히 뒀다(perch.spec 60s). 아주 느린 환경에선 flaky 가능.
- **좁은 요소**: 스프라이트보다 좁은 요소엔 중앙에 걸터앉음(진동 버그는 수정됨). 원치 않으면 content 후보 최소 폭을 64+로 올리면 됨.
- **미해결 UX 경계 2건**(결정 7, 제품 결정 대기): (A) perched 중 스크롤로 요소 top 이 `innerHeight - SPRITE_H` 를 넘으면 요소가 화면에 크게 보이는데도 팻만 조기 낙하 — `isValidRect` 를 후보 선정과 체류 유지에 겸용하는 탓. (B) perch 를 떠난 뒤 재타깃 쿨다운 4초가 낙하 시간보다 길어 항상 바닥에 착지한 뒤에야 재안착.
- **상태를 바꾸는 기능엔 반드시 E2E 를 붙인다.** 낮잠 회복 버그(결정 10)가 이 규칙이 없어 통과됐다.
- **의사결정·근거**는 `context-notes.md`(결정 1~12)에, 체크리스트는 `checklist.md`에 있음.
