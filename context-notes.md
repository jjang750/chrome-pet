# 컨텍스트 노트 — 크롬 팻 확장 하네스

작업 중 내린 결정과 근거를 계속 덧붙인다.

## 2026-07-22 초기 결정

### 결정 1 — 구축 순서: 검증 하네스 먼저
CLAUDE.md는 "명령어 한 줄로 검증 가능"을 전제하지만 package.json조차 없었다.
에이전트 팀을 아무리 잘 만들어도 `npm run check`가 없으면 루프가 성립하지 않는다.
→ 검증 하네스(도구 체계)를 먼저 부트스트랩한 뒤, 그 위에 에이전트 팀을 얹는다.

### 결정 2 — 실행 모드: 전문가 3~4인 팀 (생성-검증 지향)
core-logic-dev(순수함수 TDD) / chrome-adapter-dev(크롬 API+background+content) /
harness-qa(검증 게이트·E2E·콘솔 에러 0). sidepanel UI는 초기엔 adapter에 흡수, 필요 시 분리.

### 결정 3 — git: 홈 디렉토리 전체가 단일 저장소
chrome-pet은 독립 repo가 아니라 C:\Users\PC-727 홈 repo에 중첩돼 있고,
web-mcp-provider 등 무관한 미커밋 변경이 많다. 함부로 브랜치/커밋하면 얽힌다.
→ 커밋은 사용자 요청 시에만, chrome-pet 경로만 스코프 스테이징. 자동 커밋 금지.

### 결정 4 — `npm run check`에서 E2E 분리 (CLAUDE.md 스펙 대비 의도적 편차)
CLAUDE.md 1.1은 check가 e2e까지 전부 포함한다고 명시.
그러나 MV3 확장 E2E는 headed 크롬 + dist 빌드가 필요해 루프 게이트로는 느리고 flaky하다.
→ `check` = lint→typecheck→test→validate→build (빠른 게이트).
   `test:e2e`는 별도 명령으로 분리. 이유와 수동 실행법을 여기 남긴다.
   수동 E2E: `npm run build && npm run test:e2e` (headed 크롬 필요).
   추후 CI에서 xvfb로 check:full에 통합 가능.

### 결정 6 — feed E2E 레이스: 기능 아닌 테스트 타이밍 문제로 처리
feed.spec.ts 최초 실행 실패 — 주입한 hunger 50 대신 기본값(0/100) 렌더.
원인: background onInstalled 의 `if(!existing) savePet(createPet)` 비동기 초기화가
테스트의 상태 주입과 레이스. 뒤늦은 기본값 write 가 주입값을 덮어씀.
실사용엔 동시 writer 없어 무해 → 기능 코드는 안 건드리고 테스트만 수정.
수정: 주입 전 storage 에 `pet` 키 생길 때까지 expect.poll 대기(초기화 착지 보장) +
주입 후 재확인 방어 assertion. 향후 반복 시 waitForPetInitialized(sw) 헬퍼 추출 후보.

### 결정 7 — 데스크톱 팻(A+B) 완료, 보류된 UX 경계 2건
루프 A(오버레이·중력·배회·상태 표정) + 루프 B(요소 안착/낙하) 구현 완료.
petBehavior 순수 물리(step/spriteFrame), content 오버레이 rAF + 요소 타깃팅.
harness-qa가 지적한 UX 경계 2건 — 계약 위반 아님, 제품 결정 대기:
 A. perched 중 위로 스크롤해 요소 top이 얕게 걸치면(요소는 화면에 크게 보임) 팻만 조기 낙하.
    isValidRect의 top<0 / top>innerHeight-48 클램프 비대칭 때문.
 B. 타깃 해제 후 재타깃 4초 쿨다운 → 낙하 시작하면 바닥까지 떨어진 뒤에야 재안착(인접 요소 즉시 재안착 불가).
둘 다 고치려면 content 휴리스틱 수정 필요. 필요 시 별도 루프.

### 결정 8 — 실제 스프라이트 도입: 컷아웃→시트 파이프라인, 크기 64×104
사용자가 배경 제거 투명 PNG(433×577) 제공.
`scripts/make-sprite.mjs`가 알파 트림→면적평균 다운샘플→바닥 정렬로 6프레임 시트(src/assets/pet.png) 생성.
포즈 1개뿐이라 6프레임 동일(정적). build는 gen-sprite 생성 대신 src/assets/pet.png 복사로 전환, gen-sprite.mjs 삭제.
- 크기 48→64×104로 상향(SPRITE_W/H). 48px에선 디테일 뭉개져 식별 불가였음. core 상수·make-sprite·E2E 스펙 픽셀값 동반 수정.
- **버그 교훈:** 다운샘플 sx1 계산에서 box.x를 이중 가산해 픽셀당 소스 51px를 평균→극심한 블러. 출력 이미지를 Read로 직접 보고 발견(추측 아님). 범위식 수정 후 선명.
- 진짜 걷기/낙하 애니메이션은 포즈별 컷아웃을 더 받아야 가능(현재 정적).

### 결정 9 — 6포즈 시트로 애니메이션화 (결정 8의 정적 한계 해소)
사용자가 포즈별 6프레임 시트(sprite_images.png, 1629x965, RGB 배경 있음) 제공.
make-sprite.mjs 재작성: 테두리 flood-fill로 근백색 배경 투명화(내부 흰색 보존) →
열별 불투명 픽셀로 6프레임 자동 분리(갭 기준) → 각 트림·축소해 64x104 시트 합성.
이제 walk1/walk2 번갈이 등 진짜 애니메이션. 배경 임계 BG_MIN=236, 6구간 미검출 시 균등분할 폴백.
코드(core/content/E2E)는 무변경 — 64x104 유지, make-sprite만 교체.

### 결정 5 — core/의 chrome.* 금지를 eslint로 강제
full 커스텀 룰 대신 flat config override에서 no-restricted-globals로 src/core/** 에서
`chrome` 전역 사용을 에러 처리. 가볍고 실효성 있음.

### 결정 10 — 낮잠(sleeping)은 연출 전용, 상태 보상 제거
증상 보고: "주말이 지났는데 팻이 배고픔을 안 느낀다."

**측정으로 확인한 원인** (`step()` 1시간 시뮬레이션)
- `petBehavior` super-cycle = 4×(WALK_MS 5000 + IDLE_MS 900) + WALK_MS 5000 + SLEEP_MS 10000 = **38.6초**
- content 렌더 루프가 `sleeping → 비sleeping` 전이마다 `rest()`(배고픔 −20)를 storage 에 적용
- 1시간당 깸 **93회** → **−1860/시간** vs `decay` **+10/시간** → 순 **−1850/시간** (회복이 감쇠보다 186배 빠름)
- 결과: 48시간 방치로 hunger 100 이 되어도, 페이지에 팻이 뜬 뒤 깸 5회(**약 3.2분**)면 0 으로 리셋. 행복도도 같은 구조로 100 고정.
- `decay` 자체는 정상이었다. 설정값 오타가 아니라 **애니메이션 주기에 상태 보상을 묶은 설계 충돌**이었다.

**수정:** content 의 `rest()` 적용 블록 제거 + 유일한 호출자가 사라진 `core/petState.rest()` 제거.
배고픔·행복도는 시간 경과(`decay`)와 사용자 행동(`feed`)으로만 변한다. 낮잠은 sleep 프레임 연출로만 남는다.

**하네스 보강:** `tests/e2e/sleep-no-recovery.spec.ts` 추가.
한 super-cycle(약 43초) 관측하며 (1) storage.pet.hunger 가 주입값 미만으로 내려가지 않는지,
(2) 실제로 sleep 프레임(backgroundPositionX −448px)이 관측됐는지 함께 검증한다.
(2)가 없으면 낮잠을 지나치지 않은 것이라 통과가 위장되므로 명시적으로 실패시킨다.
버그 상태로 되돌려 실패(hunger 50 → 30)를 먼저 확인한 뒤 수정 후 통과를 확인했다.
**교훈:** 결정 9 시점에 이 낮잠 보상은 E2E 커버리지가 없었다. 상태를 바꾸는 기능은 반드시 하네스 시나리오를 동반한다.

## 2026-08-06 문서 동기화

### 결정 11 — E2E 를 `check` 게이트에 편입 (결정 4 번복)

커밋 `460fcae` 로 이미 반영됐으나 근거가 여기 기록되지 않아 뒤늦게 남긴다.
결정 4 는 E2E 가 느리고 flaky 하다는 이유로 `check` 에서 분리했다. 그 대가가 드러났다.
낮잠 회복 버그(결정 10)와 컨텍스트 무효화 버그는 **유닛 테스트가 전부 그린인 상태에서 커밋됐다**.
둘 다 크롬 런타임에서만 드러나는 배선 문제라 유닛 게이트로는 원리적으로 못 잡는다.
→ `check` = lint→typecheck→test→validate→build→**test:e2e**. 게이트가 약 3분(E2E 2.4분)으로 느려지지만,
   "유닛 그린 + 확장 깨짐" 상태가 커밋되는 것을 막는 편이 싸다.
- flaky 우려는 결정 4 시점의 추정이었다. `page.route` 로 하네스를 복구한 뒤(`9534b01`) 실측상 안정적이다.
- 여전히 headed 크롬이 필요하다. CI 도입 시 xvfb 가 전제다.

### 결정 12 — 결정 3 은 폐기 (git 저장소 구조 정정)

결정 3 은 "chrome-pet 이 홈 디렉토리 단일 repo 에 중첩돼 있다"고 기록했으나 현재는 사실이 아니다.
chrome-pet 은 자체 저장소이고 remote 는 github.com/jjang750/chrome-pet.git, 기본 브랜치는 main 이다.
→ pathspec 스코프 스테이징은 이제 필수가 아니다. 다만 무관한 미커밋 산출물이 쌓이므로
   커밋 전 `git status` 확인 습관은 유지한다.
