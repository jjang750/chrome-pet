// 오브젝트 간 이동 E2E — 팻이 한 요소에 안착 → PERCH_MS(6s) 자동 하차 → 재타깃 시 다른 요소로 이동해 안착
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension } from './harness';

// overlay/perch.spec 과 동일하게 pet.png 참조로 오버레이 div 를 특정한다.
const OVERLAY_SELECTOR = 'div[style*="pet.png"]';

// core/petBehavior 의 SPRITE_W/H 와 일치. 안착 y·후보 유효성 판정에 쓴다.
const SPRITE_W = 64;
const SPRITE_H = 104;

// content/index.ts 의 PERCH_MS(6000) + RETARGET_INTERVAL(4000) 미러링.
// 자동 하차 6s + 재타깃 쿨다운 4s + 느린 걷기(WALK_SPEED=32px/s) 를 감안해 넉넉한 timeout 을 잡는다.
// 첫 안착에 이미 수 초가 들고, 하차→배회→재타깃→걷기→상승이 이어지므로 test 전체 timeout 을 상향한다.
test.setTimeout(70_000);

// 오버레이 transform matrix(a,b,c,d,tx,ty) 에서 translateX(tx)·translateY(ty) 를 함께 읽는다.
async function readXY(
  overlay: import('@playwright/test').Locator,
): Promise<{ x: number; y: number }> {
  return overlay.evaluate((el) => {
    const t = getComputedStyle(el).transform; // matrix(a,b,c,d,tx,ty) | 'none'
    if (t === 'none') return { x: 0, y: 0 };
    const m = /matrix\(([^)]+)\)/.exec(t);
    if (!m) return { x: 0, y: 0 };
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
    return { x: parts[4], y: parts[5] }; // tx, ty
  });
}

test('팻이 한 요소에 안착한 뒤 자동 하차 후 다른 요소로 이동해 안착한다', async () => {
  const context = await launchWithExtension();
  try {
    // ── service worker 기동 대기 ─────────────────────────────────────────────
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();

    // onInstalled 초기화(pet 기본값)가 착지할 때까지 대기.
    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet != null), {
        timeout: 5000,
      })
      .toBe(true);

    // 건강한 팻으로 고정(speedFactor=1.0, 걷기 최대) + __errors 비우기.
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

    // ── 유효 후보 2개(A 왼쪽, B 오른쪽)를 팻 초기 x(화면 중앙) 좌우에 가깝게 배치 ─────
    // 각 폭 120·높이 80(40~400 이내), 같은 top=180(화면 안). 팻 초기 x 는 중앙 근처라
    // 첫 정렬 걷기 거리를 짧게 유지해(느린 32px/s) 타이밍 예산을 줄인다.
    // A/B x 범위가 겹치지 않아 "어느 요소에 앉았는지" 를 tx 로 구분할 수 있다.
    const AB_TOP = 180;
    const A_LEFT = 260;
    const B_LEFT = 620;
    const WIDTH = 120;
    const html =
      '<html><body style="margin:0">' +
      `<button id="perch-a" style="position:fixed;left:${A_LEFT}px;top:${AB_TOP}px;width:${WIDTH}px;height:80px">A</button>` +
      `<button id="perch-b" style="position:fixed;left:${B_LEFT}px;top:${AB_TOP}px;width:${WIDTH}px;height:80px">B</button>` +
      '</body></html>';
    await page.goto('data:text/html,' + encodeURIComponent(html));

    const overlay = page.locator(OVERLAY_SELECTOR);
    await expect(overlay).toHaveCount(1, { timeout: 5000 });

    // 두 요소가 모두 유효 후보인지 사전 확인(뷰포트가 작으면 조기 감지).
    const rects = await page.evaluate(() => {
      const a = document.getElementById('perch-a')!.getBoundingClientRect();
      const b = document.getElementById('perch-b')!.getBoundingClientRect();
      return {
        a: { top: a.top, left: a.left, right: a.right },
        b: { top: b.top, left: b.left, right: b.right },
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });
    for (const r of [rects.a, rects.b]) {
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeLessThanOrEqual(rects.vh - SPRITE_H);
      expect(r.right).toBeLessThanOrEqual(rects.vw);
    }

    // 안착 y 계약: perchTopY = rect.top - SPRITE_H. 두 요소 top 이 같으므로 y 는 공통.
    const perchTopY = AB_TOP - SPRITE_H;

    // 각 요소에 앉았을 때 팻 tx 가 들 수 있는 x 범위 [minX, maxX] (core 의 perched 순찰 범위).
    // minX = rect.left, maxX = max(left, right - SPRITE_W). 판정 tolerance ±SPRITE_W 여유.
    const aRange = { lo: rects.a.left, hi: Math.max(rects.a.left, rects.a.right - SPRITE_W) };
    const bRange = { lo: rects.b.left, hi: Math.max(rects.b.left, rects.b.right - SPRITE_W) };
    // A 와 B 범위가 확실히 분리돼 있어야 tx 로 구분 가능.
    expect(bRange.lo).toBeGreaterThan(aRange.hi + SPRITE_W);

    const onA = (x: number): boolean => x >= aRange.lo - 4 && x <= aRange.hi + 4;
    const onB = (x: number): boolean => x >= bRange.lo - 4 && x <= bRange.hi + 4;

    // ── ① 첫 안착: y 가 perchTopY 근처(±6) 이고 tx 가 A 또는 B 범위 안 ─────────────
    // 느린 걷기 + 재타깃 쿨다운(최대 4s) + 상승. 넉넉히 25s.
    await expect
      .poll(
        async () => {
          const { x, y } = await readXY(overlay);
          return Math.abs(y - perchTopY) <= 6 && (onA(x) || onB(x));
        },
        { timeout: 25000, intervals: [200, 300, 500, 1000] },
      )
      .toBe(true);

    // 첫 안착 요소 판별(A/B).
    const first = await readXY(overlay);
    const firstOnA = onA(first.x);
    const firstOnB = onB(first.x);
    expect(firstOnA || firstOnB).toBe(true);

    // ── ② 자동 하차 후 "다른 요소" 로 이동해 안착 ────────────────────────────────
    // PERCH_MS(6s) 자동 하차 → 낙하/배회 → RETARGET_INTERVAL(4s) 쿨다운 → 다른 요소로 걷기 → 상승.
    // lastLeftEl 제외 로직으로 방금 떠난 요소는 다른 후보가 있으면 배제된다.
    // 최악 예산: 하차 6s + 낙하~쿨다운 ~4s + 이동 걷기(360px 간격 /32px/s ≈ 11s) + 상승 1s ≈ 22s → 30s.
    await expect
      .poll(
        async () => {
          const { x, y } = await readXY(overlay);
          if (Math.abs(y - perchTopY) > 6) return false; // perched 상태여야.
          // 첫 요소가 A 였으면 지금은 B 범위, 반대면 A 범위여야 "다른 요소로 이동".
          return firstOnA ? onB(x) : onA(x);
        },
        { timeout: 30000, intervals: [300, 500, 1000] },
      )
      .toBe(true);

    // 최종 상태 재확인: 다른 요소에 확실히 안착.
    const final = await readXY(overlay);
    expect(Math.abs(final.y - perchTopY)).toBeLessThanOrEqual(6);
    if (firstOnA) {
      expect(onB(final.x)).toBe(true);
    } else {
      expect(onA(final.x)).toBe(true);
    }

    // ── ③ 콘솔 에러 0건 + 전역 __errors 비어있음 ───────────────────────────────
    expect(consoleErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
