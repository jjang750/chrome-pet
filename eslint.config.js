// eslint flat config — core/ 순수성(크롬 API 금지)과 기본 품질 규칙을 강제
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // core/ 는 크롬 API 의존이 없어야 한다 → chrome 전역 사용 금지
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'core/ 는 순수 로직만. chrome.* 는 chrome/ 어댑터에서만 사용하라.' },
      ],
    },
  },
  {
    // node 스크립트(빌드·검증)와 eslint 설정 파일은 node 전역 허용
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
  {
    // service worker / content / sidepanel / adapter 는 크롬 전역 허용
    files: ['src/chrome/**/*.ts', 'src/background/**/*.ts', 'src/content/**/*.ts', 'src/sidepanel/**/*.ts'],
    languageOptions: {
      globals: { chrome: 'readonly' },
    },
  },
);
