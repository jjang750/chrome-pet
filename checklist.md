# 크롬 팻 확장 — 하네스 구축 체크리스트

## Part A — 검증 하네스 부트스트랩 ✅
- [x] A1. package.json + npm 스크립트(lint/typecheck/test/test:e2e/validate/build/check)
- [x] A2. tsconfig.json (strict, noEmit 타입체크용)
- [x] A3. eslint flat config + core/에서 chrome.* 금지 제약
- [x] A4. vitest.config.ts
- [x] A5. playwright.config.ts
- [x] A6. src/ 골격 (core/chrome/background/sidepanel/content)
- [x] A7. manifest.json (MV3 최소)
- [x] A8. scripts/build.mjs (esbuild → dist)
- [x] A9. scripts/validate-manifest.mjs
- [x] A10. core/petState.ts 최소 순수함수 + 단위 테스트(4)
- [x] A11. tests/e2e/harness.ts + 스모크 테스트 (작성 완료, 실행은 수동)
- [x] A12. npm install
- [x] A13. npm run check 그린 확인

## Part B — 에이전트 하네스 (전문가 3인 팀) ✅
- [x] B1. agents/core-logic-dev.md
- [x] B2. agents/chrome-adapter-dev.md
- [x] B3. agents/harness-qa.md
- [~] B4. agents/sidepanel-ui-dev.md — 미생성(결정 2대로 chrome-adapter-dev에 흡수)
- [x] B5. skills/pet-loop-orchestrator (루프 강제 오케스트레이터)
- [x] B6. 에이전트별 스킬 (core-tdd, chrome-adapter, harness-qa-verify)
- [x] B7. .claude/settings.json 훅 등록
- [x] B8. CLAUDE.md 하네스 포인터 + 변경 이력 등록
- [x] B9. 구조 검증(agents 3·skills 4·commands 0) + check 그린. 트리거 A/B 테스트는 미실시(옵션)
