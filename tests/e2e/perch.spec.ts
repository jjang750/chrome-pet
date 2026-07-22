// 요소 안착/낙하 E2E — 팻이 버튼 요소 상단에 perched 후, 요소 제거 시 바닥으로 낙하 수렴 + 에러 0건
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension } from './harness';

// overlay.spec 과 동일하게 pet.png 참조로 오버레이 div 를 특정한다.
const OVERLAY_SELECTOR = 'div[style*="pet.png"]';

// core/petBehavior 의 SPRITE_H 와 일치. 안착 y·바닥 y·후보 유효성 판정에 쓴다.
// 치수 변경 시 이 상수만 고치면 된다.
const SPRITE_H = 104;

// 오버레이 transform matrix(a,b,c,d,tx,ty) 에서 translateY(ty) 를 읽는다.
// 문자열 리터럴로 page.evaluate 에 넘겨 브라우저 컨텍스트에서 실행한다.
async function readY(overlay: import('@playwright/test').Locator): Promise<number> {
  return overlay.evaluate((el) => {
    const t = getComputedStyle(el).transform; // matrix(a,b,c,d,tx,ty) | 'none'
    if (t === 'none') return 0;
    const m = /matrix\(([^)]+)\)/.exec(t);
    if (!m) return 0;
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
    return parts[5]; // ty
  });
}

test('팻이 버튼 요소 상단에 안착하고, 요소 제거 시 바닥으로 낙하한다', async () => {
  test.setTimeout(60_000); // WALK_SPEED 감소로 정렬 걷기가 길어질 수 있어 여유를 둔다.
  const context = await launchWithExtension();
  try {
    // ── service worker 기동 대기 후 확장 ID 추출 ────────────────────────────────
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();

    // onInstalled 초기화(pet 기본값 저장)가 착지할 때까지 먼저 기다린다.
    // (feed/overlay.spec 의 "pet 키 존재 폴링" 레이스 방지 패턴)
    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet != null), {
        timeout: 5000,
      })
      .toBe(true);

    // 건강한 팻으로 고정(느려지지 않게) + __errors 를 명시적으로 비운다.
    // speedFactor 는 hunger 낮고 happiness 높을수록 빠르다 → 걷기·정렬을 앞당겨 flaky 완화.
    await sw.evaluate(async () => {
      await chrome.storage.local.set({
        pet: { hunger: 0, happiness: 100, lastUpdated: Date.now() },
        __errors: [],
      });
    });

    // ── 안착 대상 요소를 명확히 배치한 테스트 페이지 ────────────────────────────
    // 후보 규칙: 태그 button/a/img/input/h1/h2, 크기 40~400px, 화면 안(top<=innerHeight-SPRITE_H).
    // 화면 좌측 상단 고정 위치에 120px 폭·80px 높이 버튼 하나만 유효 후보로 둔다.
    // 팻 초기 x 는 화면 중앙 근처(상단 낙하) → 걸어가서 정렬 후 상승.
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    // 대상 버튼을 fixed 로 명시 좌표(left 120, top 200)에 둔다. 크기 120x80 → 후보 유효.
    // 다른 요소는 두지 않아 pickTarget 이 반드시 이 버튼을 고르게 한다.
    const html =
      '<html><body style="margin:0">' +
      '<button id="perch-target" style="position:fixed;left:120px;top:200px;width:120px;height:80px">TARGET</button>' +
      '</body></html>';
    await page.goto('data:text/html,' + encodeURIComponent(html));

    const overlay = page.locator(OVERLAY_SELECTOR);
    await expect(overlay).toHaveCount(1, { timeout: 5000 });

    // 대상 버튼의 rect 를 읽는다(perch 계약: perchTopY = rect.top - SPRITE_H).
    const targetRect = await page.locator('#perch-target').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right };
    });
    // 후보 유효성 사전 확인: 크기 40~400, 화면 안. (환경 뷰포트가 작아 실패하면 조기 감지)
    expect(targetRect.top).toBeGreaterThanOrEqual(0);
    const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    expect(targetRect.top).toBeLessThanOrEqual(viewport.h - SPRITE_H);
    expect(targetRect.right).toBeLessThanOrEqual(viewport.w);

    // core 계약과 동일하게 기대 안착 y 를 계산: perchTopY = rect.top - SPRITE_H.
    const perchTopY = targetRect.top - SPRITE_H;

    // ── ① 안착: transform y 가 perchTopY 근처로 수렴(perched) ───────────────────
    // 상단 낙하 → 지면 걷기 → x 정렬 → 상승(CLIMB_SPEED 120px/s) → perched.
    // 애니메이션·재타깃 쿨다운(최대 4s) 타이밍이 있어 timeout·tolerance 를 넉넉히 둔다.
    // 안착 상태면 pos.y == perchTopY 로 고정된다(추종). tolerance ±6px.
    await expect
      .poll(async () => Math.abs((await readY(overlay)) - perchTopY), {
        timeout: 40000,
        intervals: [200, 300, 500, 1000],
      })
      .toBeLessThanOrEqual(6);

    // 안착 후에도 계속 perchTopY 를 추종하는지 한 번 더 확인(좌우 배회 중 y 는 고정).
    const yWhilePerched = await readY(overlay);
    expect(Math.abs(yWhilePerched - perchTopY)).toBeLessThanOrEqual(6);

    // ── ② 요소 제거 → 낙하: transform y 가 바닥(innerHeight-SPRITE_H) 근처로 수렴 ──
    await page.locator('#perch-target').evaluate((el) => el.remove());

    const groundY = viewport.h - SPRITE_H;
    await expect
      .poll(async () => await readY(overlay), {
        timeout: 10000,
        intervals: [100, 200, 300, 500],
      })
      // 바닥에서 3px 이내로 수렴하면 착지로 본다(프레임 타이밍 허용).
      .toBeGreaterThan(groundY - 3);

    const finalY = await readY(overlay);
    expect(finalY).toBeGreaterThan(groundY - 3);
    expect(finalY).toBeLessThanOrEqual(groundY + 1);

    // ── ③ 콘솔 에러 0건 + 전역 __errors 비어있음 ───────────────────────────────
    expect(consoleErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
