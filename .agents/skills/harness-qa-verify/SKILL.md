---
name: harness-qa-verify
description: 크롬 팻 확장의 검증 하네스를 유지·강화하고 E2E로 통합 정합성을 확인하는 방법. npm run check 게이트, E2E 하네스로 확장 로드, 콘솔 에러 0건 판정, 경계면(core↔어댑터↔UI) 교차 비교, 점진적 QA, 검증 불가 시 하네스 보강을 다룬다. harness-qa 에이전트의 작업 스킬.
---

# harness-qa-verify — 검증 하네스 & QA

## 1순위 규칙: 검증 불가 → 하네스부터
어떤 변경을 기존 명령어(`npm run check`, `test:e2e`)로 확인할 수 없으면,
**기능 구현을 멈추고 그 변경을 검증할 테스트·스크립트부터 만든다.** 확인 못 하는 코드는 완료가 아니다.

## 경계면 교차 비교 (버그가 나는 곳)
"파일이 있는가"가 아니라 **shape 이 일치하는가**를 본다. 세 곳을 동시에 읽어 비교한다.
- `src/core/petState.ts` 의 `PetState` 타입
- `src/chrome/storage.ts` 가 저장/복원하는 형태
- `src/sidepanel/` 가 렌더링에 기대하는 필드
하나라도 어긋나면 불일치 리포트를 담당 에이전트에 보낸다(재현 케이스 포함).

## E2E 하네스
`tests/e2e/harness.ts` 의 `launchWithExtension()` 로 dist unpacked 확장 로드.
반드시 확인:
1. SW 가 에러 없이 기동 — `context.serviceWorkers()`
2. side panel 렌더
3. **콘솔 에러 0건** — `page.on('console')` 로 error 수집, 1건이라도 있으면 실패. SW `__errors` 키도 확인.
4. `chrome.storage` 상태 저장/복원
- 실행: `npm run build && npm run test:e2e` (headed 크롬, 최초 `npx playwright install chromium`).

## 점진적 QA
전체 완성 후 1회가 아니라 **모듈 완성 직후마다** 검증한다. 늦게 잡을수록 원인 추적이 비싸다.

## 하네스 강화 규칙
- 테스트를 통과시키려 skip/disable/주석 처리 금지. 실패는 근본 원인을 찾는다.
- 반복되는 검증 코드는 `scripts/` 나 `tests/e2e/harness.ts` 에 번들링해 재사용.
- 새 검증 축이 생기면 `npm run check` 에 넣을지 판단(느리고 flaky 하면 별도 명령으로).

## 완료 기준
검증 결과를 근거(로그·shape 비교)와 함께 보고. 불일치는 재현 케이스로 담당자에게 전달.
