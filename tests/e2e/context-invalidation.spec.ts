// 확장 컨텍스트 무효화 E2E — 확장 리로드 후 content 오버레이가 스스로 제거되고
// 'Extension context invalidated' 에러가 반복되지 않는지 확인(유령 팻·에러 스팸 회귀 방지)
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension, gotoLocalPage } from './harness';

// overlay.spec 와 동일하게 pet.png 참조로 오버레이 div 를 식별한다.
const OVERLAY_SELECTOR = 'div[style*="pet.png"]';

test('확장 리로드로 컨텍스트가 무효화되면 오버레이가 스스로 제거되고 에러 스팸이 없다', async () => {
  const context = await launchWithExtension();
  try {
    // service worker 기동 대기
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();

    // onInstalled 초기화(pet 기본값 저장)가 정착할 때까지 대기.
    await expect
      .poll(
        async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet != null),
        { timeout: 5000 },
      )
      .toBe(true);

    // content script 는 일반 http(s) 출처에만 주입된다(최신 크롬은 최상위 data: URL 에 미주입).
    // gotoLocalPage 가 route 로컬 응답으로 실제 https 출처를 만들어 그 위에서 검증한다.
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await gotoLocalPage(page, '<html><body><h1>ctx test</h1></body></html>');

    // 오버레이가 정상 주입돼 붙는다.
    const overlay = page.locator(OVERLAY_SELECTOR);
    await expect(overlay).toHaveCount(1, { timeout: 5000 });

    // ── 확장 리로드 → 이 페이지의 content script 컨텍스트가 무효화된다 ──────────────────
    // reload 는 현재 SW 를 종료시키므로 evaluate 가 reject 될 수 있다. 무효화 자체가 목적이라 무시한다.
    // 리로드 후 이 data URL 페이지에는 새 content script 가 주입되지 않으므로(내비게이션 없음),
    // 기존 오버레이는 프레임 가드가 스스로 정리해야만 사라진다.
    await sw.evaluate(() => chrome.runtime.reload()).catch(() => {});

    // frame() 의 isExtensionContextValid 가드가 다음 rAF 에서 무효를 감지 → stop()+el.remove().
    // 수정 전에는 유령 팻이 영구히 남았다. 이 count 0 이 회귀 방지 핵심 관찰점이다.
    await expect(overlay).toHaveCount(0, { timeout: 8000 });

    // 정리 경로 자체가 'Extension context invalidated' 를 다시 던지지 않았는지 확인(에러 스팸 0건).
    const ctxErrors = consoleErrors.filter((t) => /context invalidated/i.test(t));
    expect(ctxErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
