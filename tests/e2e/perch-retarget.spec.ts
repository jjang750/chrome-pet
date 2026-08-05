// 재안착 지연 E2E — 자동 하차 후 벽시계 쿨다운(4s) 없이 낙하+상승 시간만으로 다시 올라탄다
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension, gotoLocalPage } from './harness';

// 다른 perch 스펙과 동일하게 pet.png 참조로 오버레이 div 를 특정한다.
const OVERLAY_SELECTOR = 'div[style*="pet.png"]';

// core/petBehavior 의 SPRITE_H · G · CLIMB_SPEED 미러링. 예상 소요 시간 산출에 쓴다.
const SPRITE_H = 104;
const G = 700;
const CLIMB_SPEED = 120;

// 하차→재안착 허용 상한(ms). 낙하+상승 실측치(약 1.8s)와 구 동작(쿨다운 4s + 상승 ≈ 5.2s) 사이 값.
// 이 값을 넘으면 벽시계 쿨다운이 살아있다는 뜻이다.
const REPERCH_BUDGET_MS = 3500;

test.setTimeout(60_000);

async function readY(overlay: import('@playwright/test').Locator): Promise<number> {
  return overlay.evaluate((el) => {
    const t = getComputedStyle(el).transform; // matrix(a,b,c,d,tx,ty) | 'none'
    if (t === 'none') return 0;
    const m = /matrix\(([^)]+)\)/.exec(t);
    if (!m) return 0;
    return parseFloat(m[1].split(',')[5].trim()); // ty
  });
}

/** 조건이 참이 될 때까지 100ms 간격으로 폴링하고, 참이 된 시각(Date.now)을 돌려준다. */
async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return Date.now();
    if (Date.now() > deadline) throw new Error(`waitUntil 시간 초과: ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('자동 하차 후 벽시계 쿨다운 없이 낙하·상승 시간만으로 재안착한다', async () => {
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

    // ── 유효 후보 1개를 화면 하단 근처·가로 중앙에 둔다 ─────────────────────────
    // 하단 근처(top ≈ vh-140)라 낙하·상승 거리가 140px 로 짧다 → 쿨다운 유무를 시간으로 구분할 수 있다.
    // 가로 중앙이라 팻 초기 x(중앙)에서 바로 정렬돼 걷기 시간이 예산에 섞이지 않는다.
    // 후보가 하나뿐이라 하차 후에도 같은 요소로 다시 올라간다(lastLeftEl 예비 경로).
    const html =
      '<html><body style="margin:0">' +
      '<button id="perch-a" style="position:fixed;bottom:60px;left:calc(50% - 60px);' +
      'width:120px;height:80px">A</button>' +
      '</body></html>';
    await gotoLocalPage(page, html);

    const overlay = page.locator(OVERLAY_SELECTOR);
    await expect(overlay).toHaveCount(1, { timeout: 5000 });

    const geom = await page.evaluate(() => {
      const r = document.getElementById('perch-a')!.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right, vw: window.innerWidth, vh: window.innerHeight };
    });
    // 선정 기준(top <= vh - SPRITE_H)과 좌우 조건을 만족하는 유효 후보여야 한다.
    expect(geom.top).toBeLessThanOrEqual(geom.vh - SPRITE_H);
    expect(geom.left).toBeGreaterThanOrEqual(0);
    expect(geom.right).toBeLessThanOrEqual(geom.vw);

    const perchY = geom.top - SPRITE_H;
    const groundY = geom.vh - SPRITE_H;
    const fallPx = groundY - perchY;

    // 예산이 물리적으로 가능한지 테스트가 직접 확인한다(뷰포트가 크면 낙하·상승이 길어 위장 실패).
    const fallMs = Math.sqrt((2 * fallPx) / G) * 1000;
    const climbMs = (fallPx / CLIMB_SPEED) * 1000;
    expect(fallMs + climbMs).toBeLessThan(REPERCH_BUDGET_MS);

    // ── ① 첫 안착 ────────────────────────────────────────────────────────────
    await waitUntil(async () => Math.abs((await readY(overlay)) - perchY) <= 6, 30000, '첫 안착');

    // ── ② 자동 하차(PERCH_MS 6s) 감지 → 재안착까지의 시간 측정 ──────────────────
    const leftAt = await waitUntil(
      async () => (await readY(overlay)) > perchY + 20,
      12000,
      '자동 하차',
    );
    const backAt = await waitUntil(
      async () => Math.abs((await readY(overlay)) - perchY) <= 6,
      20000,
      '재안착',
    );

    const elapsed = backAt - leftAt;
    // 구 동작(하차 시 4s 벽시계 쿨다운)이면 상승 시간까지 더해 5s 를 넘는다.
    expect(elapsed).toBeLessThanOrEqual(REPERCH_BUDGET_MS);
    // 낙하·상승을 실제로 거쳤는지 하한도 확인한다(0 에 가까우면 하차 감지가 위장된 것).
    expect(elapsed).toBeGreaterThanOrEqual(fallMs * 0.5);

    // ── ③ 콘솔 에러 0건 + 전역 __errors 비어있음 ───────────────────────────────
    expect(consoleErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
