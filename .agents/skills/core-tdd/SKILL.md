---
name: core-tdd
description: src/core/ 순수 로직을 TDD로 구현하는 방법. 팻 상태머신·시간 경과·도메인 규칙 등 크롬 API 없는 순수 함수를 만들 때 사용. 시간·랜덤 주입, 실패 테스트 우선, vitest 패턴을 다룬다. core-logic-dev 에이전트의 작업 스킬.
---

# core-tdd — 순수 로직 TDD

## 왜 이렇게 하는가
`src/core/` 는 크롬 없이 vitest 로 밀리초 단위로 검증된다. 이 속도와 재현성이 루프를 빠르게 만든다.
크롬 API 가 섞이면 이 이점이 사라지므로 core 는 순수하게 유지한다.

## 순서
1. **실패 테스트 먼저** — `src/core/<name>.test.ts` 에 원하는 동작을 assert. 실행해 빨간색 확인.
2. **최소 구현** — 테스트를 통과시킬 최소 코드만. 추측 기능 금지.
3. `npm run test` 그린 확인.

## 규칙
- **시간·랜덤 주입.** `Date.now()`·`Math.random()` 직접 호출 금지. `decay(state, now: number)` 처럼 인자로 받는다. (프로젝트 규칙: `Date.now()` 등은 재현성을 깬다.)
- **chrome.* 금지.** eslint 가 `src/core/**` 에서 막는다. 상태를 저장·조회해야 하면 순수 함수는 새 상태를 *반환*만 하고, 저장은 chrome-adapter-dev 가 한다.
- **경계값 테스트.** clamp(0~100), 시계 역행, 0 경과 등 엣지를 반드시 커버.
- **상태 타입은 직렬화 형태.** `PetState` 는 chrome.storage 에 그대로 저장된다. 타입을 바꾸면 chrome-adapter-dev·harness-qa 에 알린다.

## vitest 패턴
```ts
import { describe, it, expect } from 'vitest';
import { decay, createPet } from './petState';

it('1시간 경과 시 배고픔 증가', () => {
  expect(decay(createPet(0), 3_600_000).hunger).toBe(10);
});
```

## 완료 기준
`npm run test` 그린 + 엣지 케이스 커버 + 타입 변경 시 팀 통지.
