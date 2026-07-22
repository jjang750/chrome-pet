// 확장을 실제 크롬에 로드해 검증하는 E2E 설정 (MV3 제약상 headed)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
});
