// 모든 E2E 테스트의 진입점 — dist 의 unpacked 확장을 로드한 크롬 컨텍스트를 만든다
import { chromium, type BrowserContext, type Page } from '@playwright/test';
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

// content script 검증용 로컬 테스트 페이지를 연다.
// 최신 크롬은 최상위 data: URL 문서에는 content script 를 주입하지 않으므로(일반 http(s) 만 주입),
// route 로컬 응답으로 실제 https 출처를 만들어 그 위에서 팻 오버레이를 검증한다(네트워크 의존 없음).
export async function gotoLocalPage(page: Page, html: string): Promise<void> {
  await page.route('https://pet.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto('https://pet.test/');
}
