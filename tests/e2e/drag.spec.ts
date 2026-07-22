// 드래그 이동 E2E — 착지한 팻을 포인터로 잡아 끌면 커서를 따라오고(held=idle 프레임),
// 놓으면 그 지점에서 바닥으로 낙하 수렴하며 콘솔/전역 에러 0건 확인
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension } from './harness';

// core/petBehavior 의 SPRITE_W/H 와 일치. 치수 변경 시 이 두 상수만 고치면 된다.
// content 의 pointermove clamp 는 [0, innerWidth-SPRITE_W] × [0, innerHeight-SPRITE_H].
const SPRITE_W = 64;
const SPRITE_H = 104;

// held 동안 spriteFrame 은 'idle'(FRAME_INDEX.idle = 0) → background-position-x = -0px.
// 브라우저는 -0px 를 '0px' 로 정규화하므로 두 표기를 모두 허용한다.
const IDLE_BG_POS_X = ['0px', '-0px'];

const OVERLAY_SELECTOR = 'div[style*="pet.png"]';

// 오버레이 transform matrix(a,b,c,d,tx,ty) 에서 translate(tx,ty) 를 읽는다.
// scaleX(±1) 이 섞여 a=±1 이지만 tx/ty 위치(index 4,5)는 동일하다.
async function readPos(
  overlay: import('@playwright/test').Locator,
): Promise<{ x: number; y: number }> {
  return overlay.evaluate((el) => {
    const t = getComputedStyle(el).transform; // matrix(a,b,c,d,tx,ty) | 'none'
    if (t === 'none') return { x: 0, y: 0 };
    const m = /matrix\(([^)]+)\)/.exec(t);
    if (!m) return { x: 0, y: 0 };
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
    return { x: parts[4], y: parts[5] };
  });
}

test('착지한 팻을 드래그하면 커서를 따라오고 놓으면 그 자리에서 낙하한다', async () => {
  const context = await launchWithExtension();
  try {
    // ── service worker 기동 대기 후 확장 초기화 착지 대기 ────────────────────────
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();

    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet != null), {
        timeout: 5000,
      })
      .toBe(true);

    // __errors 를 비워 이전 상태 오염 제거.
    await sw.evaluate(async () => {
      await chrome.storage.local.set({ __errors: [] });
    });

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    // perch 후보가 없는 최소 문서 → 팻은 낙하 후 지면에서 걷기/멈춤만 한다(드래그 방해 요소 없음).
    await page.goto('data:text/html,<html><body style="margin:0"><h1>drag test</h1></body></html>');

    const overlay = page.locator(OVERLAY_SELECTOR);
    await expect(overlay).toHaveCount(1, { timeout: 5000 });

    const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const groundY = viewport.h - SPRITE_H;

    // ── ① 착지 대기: transform y 가 바닥 근처로 수렴 ────────────────────────────
    await expect
      .poll(async () => (await readPos(overlay)).y, {
        timeout: 8000,
        intervals: [100, 200, 300, 500],
      })
      .toBeGreaterThan(groundY - 3);

    // ── ② 착지한 팻 중심을 잡는다. 지면에서 x 는 걷기로 계속 변하므로,
    // 잡기 직전에 현재 좌표를 읽어 그 중심으로 곧장 포인터를 옮긴 뒤 누른다.
    const startPos = await readPos(overlay);
    const grabX = startPos.x + SPRITE_W / 2;
    const grabY = startPos.y + SPRITE_H / 2;

    await page.mouse.move(grabX, grabY);
    await page.mouse.down();

    // ── ③ 목표 좌표로 여러 스텝에 걸쳐 끈다. clamp 경계 안(중앙 상단 근처)으로 목표를 잡는다.
    // 목표 팻 좌상단 = (targetLeft, targetTop). 커서는 팻 중심이므로 +SPRITE/2.
    const targetLeft = Math.round(viewport.w * 0.5);
    const targetTop = Math.round(viewport.h * 0.25);
    const targetCursorX = targetLeft + SPRITE_W / 2;
    const targetCursorY = targetTop + SPRITE_H / 2;

    await page.mouse.move(targetCursorX, targetCursorY, { steps: 20 });

    // 드래그 중 팻 좌상단이 목표(커서-오프셋=targetLeft/Top) 근처를 따라오는지 확인.
    // 오프셋은 잡은 지점(팻 중심)이라 SPRITE/2 → 목표 좌상단 = targetLeft/targetTop.
    // rAF 반영·이벤트 타이밍 방어로 poll + tolerance(±8px).
    await expect
      .poll(async () => {
        const p = await readPos(overlay);
        return Math.max(Math.abs(p.x - targetLeft), Math.abs(p.y - targetTop));
      }, { timeout: 3000, intervals: [50, 100, 150, 200] })
      .toBeLessThanOrEqual(8);

    // ── ④ 드래그(held) 중 스프라이트는 idle 프레임(background-position-x = 0px) ────
    // held → spriteFrame='idle' → FRAME_INDEX 0 → -0px. 브라우저가 '0px' 로 정규화.
    const bgWhileHeld = await overlay.evaluate((el) => getComputedStyle(el).backgroundPositionX);
    expect(IDLE_BG_POS_X).toContain(bgWhileHeld);

    // ── ⑤ 놓기 → 놓은 지점(targetTop)에서 바닥으로 낙하 수렴 ─────────────────────
    // 놓기 직전 y 가 바닥보다 위(targetTop < groundY)여야 낙하가 관측된다. 사전 확인.
    expect(targetTop).toBeLessThan(groundY - 10);

    await page.mouse.up();

    await expect
      .poll(async () => (await readPos(overlay)).y, {
        timeout: 8000,
        intervals: [100, 200, 300, 500],
      })
      .toBeGreaterThan(groundY - 3);

    const finalY = (await readPos(overlay)).y;
    expect(finalY).toBeGreaterThan(groundY - 3);
    expect(finalY).toBeLessThanOrEqual(groundY + 1);

    // ── ⑥ 콘솔 에러 0건 + 전역 __errors 비어있음 ───────────────────────────────
    expect(consoleErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
