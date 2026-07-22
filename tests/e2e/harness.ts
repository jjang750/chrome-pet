// 모든 E2E 테스트의 진입점 — dist 의 unpacked 확장을 로드한 크롬 컨텍스트를 만든다
import { chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

export async function launchWithExtension(): Promise<BrowserContext> {
  const extPath = path.resolve(dir, '../../dist');
  return chromium.launchPersistentContext('', {
    headless: false, // MV3 확장은 headless 제약. CI 에서는 xvfb 사용
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  });
}
