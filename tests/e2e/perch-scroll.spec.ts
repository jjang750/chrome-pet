// perch 체류 유지 E2E — 안착 후 스크롤로 요소가 아래로 밀려도 요소가 화면에 보이는 동안은 떨어지지 않는다
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension, gotoLocalPage } from './harness';

// 다른 perch 스펙과 동일하게 pet.png 참조로 오버레이 div 를 특정한다.
const OVERLAY_SELECTOR = 'div[style*="pet.png"]';

// core/petBehavior 의 SPRITE_H 와 일치. 안착 y = rect.top - SPRITE_H.
const SPRITE_H = 104;

// content/index.ts 의 KEEP_MARGIN 미러링. 체류 유지 하한(요소 top 이 화면 하단에서 이만큼은 떠 있어야).
const KEEP_MARGIN = 16;

// 첫 안착까지 느린 걷기(32px/s)+재타깃 쿨다운이 들고, 그 뒤 스크롤·관측이 이어진다.
test.setTimeout(60_000);

// 오버레이 transform matrix(a,b,c,d,tx,ty) 에서 translateY(ty) 를 읽는다.
async function readY(overlay: import('@playwright/test').Locator): Promise<number> {
  return overlay.evaluate((el) => {
    const t = getComputedStyle(el).transform; // matrix(a,b,c,d,tx,ty) | 'none'
    if (t === 'none') return 0;
    const m = /matrix\(([^)]+)\)/.exec(t);
    if (!m) return 0;
    return parseFloat(m[1].split(',')[5].trim()); // ty
  });
}

test('안착 중 스크롤로 요소가 아래로 밀려도 화면에 보이는 동안은 계속 올라타 있다', async () => {
  const context = await launchWithExtension();
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();

    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet != null), {
        timeout: 5000,
      })
      .toBe(true);

    // 건강한 팻으로 고정(speedFactor=1.0 → 걷기 최대 속도) + __errors 비우기.
    await sw.evaluate(async () => {
      await chrome.storage.local.set({
        pet: { hunger: 0, happiness: 100, lastUpdated: Date.now() },
        __errors: [],
      });
    });

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    // ── 스크롤 가능한 문서에 유효 후보 1개를 절대 위치로 둔다 ─────────────────────
    // position:absolute 라 스크롤에 따라 rect.top 이 변한다(fixed 면 안 변해 이 시나리오를 못 만든다).
    // body(2500px) 자체는 후보 제외 태그이므로 유효 후보는 이 버튼 하나뿐이다.
    // left 는 팻 초기 x(화면 중앙)에 가깝게 둬 첫 정렬 걷기를 짧게 유지한다.
    const EL_ABS_TOP = 1000;
    const EL_LEFT = 560;
    const html =
      '<html><body style="margin:0;height:2500px">' +
      `<button id="perch-a" style="position:absolute;left:${EL_LEFT}px;top:${EL_ABS_TOP}px;width:120px;height:80px">A</button>` +
      '</body></html>';
    await gotoLocalPage(page, html);

    // 요소가 뷰포트 안(top=300)에 오도록 미리 스크롤해 둔다.
    const FIRST_TOP = 300;
    await page.evaluate((y) => window.scrollTo(0, y), EL_ABS_TOP - FIRST_TOP);

    const overlay = page.locator(OVERLAY_SELECTOR);
    await expect(overlay).toHaveCount(1, { timeout: 5000 });

    const vh = await page.evaluate(() => window.innerHeight);
    // 요소가 선정 기준(top <= vh - SPRITE_H)을 만족해야 첫 안착이 가능하다.
    expect(FIRST_TOP).toBeLessThanOrEqual(vh - SPRITE_H);

    // ── ① 첫 안착: y ≈ FIRST_TOP - SPRITE_H ───────────────────────────────────
    const firstPerchY = FIRST_TOP - SPRITE_H;
    await expect
      .poll(async () => Math.abs((await readY(overlay)) - firstPerchY) <= 6, {
        timeout: 30000,
        intervals: [200, 300, 500],
      })
      .toBe(true);

    // ── ② 위로 스크롤해 요소 top 을 "선정 기준 밖 · 체류 기준 안" 밴드로 옮긴다 ────
    // 선정 기준은 top <= vh - SPRITE_H(=vh-104), 체류 기준은 top <= vh - KEEP_MARGIN(=vh-16).
    // 그 사이 값(vh-60)으로 옮기면 "새로 고르진 않지만 이미 올라탄 건 유지" 를 판별할 수 있다.
    const NEXT_TOP = vh - 60;
    expect(NEXT_TOP).toBeGreaterThan(vh - SPRITE_H); // 선정 기준 밖
    expect(NEXT_TOP).toBeLessThanOrEqual(vh - KEEP_MARGIN); // 체류 기준 안
    await page.evaluate((y) => window.scrollTo(0, y), EL_ABS_TOP - NEXT_TOP);

    // 스크롤 후 실제 rect.top 이 의도한 값인지 확인(스크롤 상한에 걸리지 않았는지).
    const actualTop = await page.evaluate(
      () => document.getElementById('perch-a')!.getBoundingClientRect().top,
    );
    expect(Math.abs(actualTop - NEXT_TOP)).toBeLessThanOrEqual(2);

    // ── ③ 팻이 요소 top 을 계속 추종한다(바닥으로 떨어지지 않는다) ──────────────
    // 버그 상태에서는 타깃이 해제돼 ground(vh - SPRITE_H) 로 낙하한다.
    const keptPerchY = NEXT_TOP - SPRITE_H;
    const groundY = vh - SPRITE_H;
    expect(groundY - keptPerchY).toBeGreaterThan(20); // 두 값이 충분히 구분돼야 판별이 성립.

    // 스크롤 직후 몇 프레임 안에 새 top 을 추종해야 한다.
    await expect
      .poll(async () => Math.abs((await readY(overlay)) - keptPerchY) <= 6, {
        timeout: 2000,
        intervals: [100, 200],
      })
      .toBe(true);

    // 한 번 맞은 게 우연이 아님을 확인 — 1초 동안 표본 5개가 모두 perch y 여야 한다.
    for (let i = 0; i < 5; i++) {
      const y = await readY(overlay);
      expect(Math.abs(y - keptPerchY)).toBeLessThanOrEqual(6);
      await page.waitForTimeout(200);
    }

    // ── ④ 콘솔 에러 0건 + 전역 __errors 비어있음 ───────────────────────────────
    expect(consoleErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
