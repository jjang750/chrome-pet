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
