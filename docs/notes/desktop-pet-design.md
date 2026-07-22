# 설계 노트 — 데스크톱 팻 (웹페이지 위 마스코트)

작성 2026-07-22. 브레인스토밍 승인 완료 후 기록.

## 목표
웹페이지 위에 떠다니는 팻 캐릭터. 중력으로 낙하·바닥 배회, 상태(배고픔·행복)에 따라 표정·속도 변화.
이어서 DOM 요소(버튼 등) 위로 올라타고 요소가 움직이면 떨어진다.

## 결정 사항 (브레인스토밍)
- 위치: 웹페이지 오버레이(content script, top 프레임만).
- 비주얼: 이미지 스프라이트. 지금은 스크립트 생성 플레이스홀더 PNG, 진짜 아트는 나중에 교체.
- 행동: 중력·낙하·바닥 배회 + 상태 표정 → 이어서 DOM 요소 안착/낙하.
- 스코프: 루프 A + 루프 B 둘 다 진행.

## 아키텍처 (core/chrome 분리)
- `src/core/petBehavior.ts` (순수, vitest) — 물리·행동 상태머신. DOM 의존 0.
  - 모드: idle | walking | falling | perched
  - step(body, env, mood, dtMs) → 다음 body. 중력·걷기·끝 반전. randomness/Date 주입 안 씀(결정적).
  - spriteFrame(body, mood) → 프레임 키.
- `src/content/` (chrome) — 오버레이 DOM + requestAnimationFrame 루프. rect 읽어 step 호출 → 좌표 적용 → 프레임 세팅. storage에서 mood 읽고 onChanged 갱신. pointer-events:none, visibilitychange로 정지.

## 스프라이트
- `scripts/gen-sprite.mjs` (pngjs) → `src/assets/pet.png` 스프라이트 시트. build가 dist로 복사.
- content는 background-position으로 프레임 슬라이스.

## manifest
- `web_accessible_resources`에 pet.png 등록. content_scripts는 기존 <all_urls>, top 프레임만.

## 데이터 흐름
- mood(배고픔·행복): chrome.storage.local(기존 단일 진실). 위치·속도는 페이지별 휘발성(메모리).

## 루프 분할
- 루프 A: core petBehavior(중력+걷기) + content 오버레이·rAF·렌더 + 스프라이트 생성 + 상태 표정 + manifest.
- 루프 B: petBehavior perch/climb 타깃팅 + content 요소 선택 휴리스틱 + 이동·제거 시 낙하.

## 검증
- core: vitest — 중력→바닥 정지, 끝 반전, (B)perch rect 안착·null이면 낙하.
- E2E: 오버레이 존재, 낙하 후 바닥 근처, (B)대상 요소 상단 근처, 콘솔 에러 0.

## 우려
- <all_urls> 침투성 — pointer-events:none로 클릭 비차단. 향후 on/off 토글 별도 루프 후보.
- 성능 — rAF 가볍게, 탭 숨김 시 정지.
