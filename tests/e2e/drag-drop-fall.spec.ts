// 회귀 E2E — 요소로 걸어가는 중(perch 잡힘)에 잡아서 떨궈도 낙하 모션이 살아있는지 확인
// 버그: 미정렬 perch 분기가 pos.y 를 ground 로 스냅해 "모션 없이 팍 떨어지는" 현상이 났다.
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension, gotoLocalPage } from './harness';

const SPRITE_W = 64;
const SPRITE_H = 104;

const OVERLAY_SELECTOR = 'div[style*="pet.png"], div[style*="pet2.png"], div[style*="pet3.png"]';

function readPos(el: Element): { x: number; y: number } {
  const t = getComputedStyle(el).transform;
  if (t === 'none') return { x: 0, y: 0 };
  const m = /matrix\(([^)]+)\)/.exec(t);
  if (!m) return { x: 0, y: 0 };
  const p = m[1].split(',');
  return { x: parseFloat(p[4].trim()), y: parseFloat(p[5].trim()) };
}

test('perch 타깃이 잡힌 상태에서 떨궈도 지면으로 순간이동하지 않고 낙하한다', async () => {
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
      await chrome.storage.local.set({ __errors: [] });
    });

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    // 화면 오른쪽 아래에 안착 후보를 하나 둔다 → 팻이 그쪽으로 걸어가며 perch 를 잡는다.
    await gotoLocalPage(
      page,
      `<html><body style="margin:0">
         <div id="target" style="position:fixed; right:40px; bottom:160px;
              width:200px; height:60px; background:#cde">안착 후보</div>
       </body></html>`,
    );

    const overlay = page.locator(OVERLAY_SELECTOR);
    await expect(overlay).toHaveCount(1, { timeout: 5000 });

    const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const groundY = viewport.h - SPRITE_H;

    // ── ① 지면 도착 대기 — 이때부터 content 가 perch 타깃을 잡기 시작한다 ──────
    await expect
      .poll(async () => (await overlay.evaluate(readPos)).y, {
        timeout: 8000,
        intervals: [100, 200, 300, 500],
      })
      .toBeGreaterThan(groundY - 3);

    // perch 타깃 확보 + 그쪽으로 걷기 시작할 시간을 준다(RETARGET_INTERVAL 여유 포함).
    await page.waitForTimeout(1500);

    // ── ② 걷는 중에 잡아서 화면 위쪽(요소와 가로로 어긋난 왼쪽)으로 끌고 간다 ──────
    // 왼쪽으로 옮겨야 perch 미정렬 분기를 확실히 타 회귀를 재현할 수 있다.
    const before = await overlay.evaluate(readPos);
    await page.mouse.move(before.x + SPRITE_W / 2, before.y + SPRITE_H / 2);
    await page.mouse.down();

    const dropLeft = 20;
    const dropTop = 60; // 지면보다 한참 위
    await page.mouse.move(dropLeft + SPRITE_W / 2, dropTop + SPRITE_H / 2, { steps: 10 });

    const held = await overlay.evaluate(readPos);
    expect(Math.abs(held.y - dropTop)).toBeLessThanOrEqual(8);

    // ── ③ 놓는다 → 다음 몇 프레임 동안 '중간 높이'가 관측돼야 한다 ────────────
    await page.mouse.up();

    // 순간이동이면 첫 샘플부터 groundY 다. 낙하면 dropTop~groundY 사이 값이 잡힌다.
    let sawMidAir = false;
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      const p = await overlay.evaluate(readPos);
      if (p.y > dropTop + 5 && p.y < groundY - 5) {
        sawMidAir = true;
        break;
      }
      if (p.y >= groundY - 1) break; // 이미 착지 — 더 볼 필요 없음
      await page.waitForTimeout(16);
    }
    expect(sawMidAir, '놓은 뒤 공중 중간 높이가 한 번도 관측되지 않았다(순간이동)').toBe(true);

    // ── ④ 최종적으로는 지면에 안착한다(낙하가 멈추지 않고 완료되는지) ──────────
    await expect
      .poll(async () => (await overlay.evaluate(readPos)).y, {
        timeout: 8000,
        intervals: [100, 200, 300, 500],
      })
      .toBeGreaterThan(groundY - 3);

    // ── ⑤ 콘솔 에러 0건 ────────────────────────────────────────────────
    expect(consoleErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
