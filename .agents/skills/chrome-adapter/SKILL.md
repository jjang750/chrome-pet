---
name: chrome-adapter
description: 크롬 API 계층(src/chrome 어댑터, background service worker, content 알림 프록시, sidepanel UI)을 MV3 제약에 맞게 구현하는 방법. alarms vs setInterval, 30초 유휴 종료, chrome.storage 단일 진실, Notification 프록시, 얇은 어댑터 패턴을 다룬다. chrome-adapter-dev 에이전트의 작업 스킬.
---

# chrome-adapter — 크롬 API·통합 구현

## MV3 제약 (왜 지켜야 하는가)
- **service worker 는 유휴 30초 후 죽는다.** 그래서 `setInterval` 은 무의미 → `chrome.alarms`(최소 주기 30초)로 깨운다. 메모리 상태도 SW 와 함께 사라지므로 신뢰하면 안 된다.
- **단일 진실 공급원 = `chrome.storage.local`.** SW 가 언제 죽어도 상태가 남아야 한다. 매 알람마다 storage 에서 읽고 → core 순수함수로 계산 → 다시 저장.
- **알림 감지는 content script 의 `window.Notification` 프록시만 가능.** OS/타 확장 알림은 접근 불가 — 시도하면 시간 낭비. 프록시가 잡은 이벤트만 SW 로 `chrome.runtime.sendMessage` 로 전달.
- **side panel 은 vanilla TS + CSS.** 프레임워크 도입 금지(가벼움 유지).

## 얇은 어댑터 패턴
어댑터는 크롬 API 호출만. 로직 금지.
```ts
// src/chrome/storage.ts — 저장/조회만. 계산은 core 가 한다.
export async function loadPet(): Promise<PetState | undefined> { ... }
export async function savePet(s: PetState): Promise<void> { ... }
```
계산 규칙이 필요하면 core-logic-dev 에 요청한다.

## 조용한 실패 금지
- SW 전역 에러는 `chrome.storage.local` 의 `__errors` 키에 기록(E2E 판정용).
```ts
self.addEventListener('error', (e) => recordError(e.message));
self.addEventListener('unhandledrejection', (e) => recordError(String(e.reason)));
```
- `console.error` 를 삼키지 않는다.

## 검증
- 어댑터/SW/UI 는 단위 테스트로 안 잡힌다 → `npm run build && npm run test:e2e`.
- 권한 누락이 흔한 실패 → 새 API 쓰면 `manifest.json` permissions 갱신 후 `npm run validate`.
- 스스로 E2E 확인이 어려우면 harness-qa 에 재현·검증 요청.

## 완료 기준
`npm run check`(build 포함) 통과 + 통합 변경이면 E2E 콘솔 에러 0건.
