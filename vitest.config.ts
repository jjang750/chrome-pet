// core/ 순수 로직 단위 테스트 실행 설정 (크롬 API 없이 빠르게)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
