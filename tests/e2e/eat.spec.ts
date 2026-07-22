// 먹이 애니메이션 E2E — hunger 감소(먹이) 감지 시 content 가 eating(-512px) 프레임을 ~2초 보여주는지 확인
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension } from './harness';

// core/petBehavior 의 SPRITE_W/H 와 일치. content 의 FRAME_INDEX.eat = 8 → background-position-x = -8*SPRITE_W.
const SPRITE_W = 64;
const SPRITE_H = 104;
const EAT_FRAME_INDEX = 8;
const EAT_BG_POS_X = `${-EAT_FRAME_INDEX * SPRITE_W}px`;

// content 의 EAT_MS(2000) 미러링. eating 은 이 시간 뒤 falling 으로 해제된다.
const EAT_MS = 2000;

const OVERLAY_SELECTOR = 'div[style*="pet.png"]';

// transform matrix 에서 translateY(ty)를 읽는다.
function readTy(el: Element): number {
  const t = getComputedStyle(el).transform;
  if (t === 'none') return 0;
  const m = /matrix\(([^)]+)\)/.exec(t);
  if (!m) return 0;
  return parseFloat(m[1].split(',')[5].trim());
}

test('hunger 감소(먹이) 감지 시 eating 프레임(-512px)이 ~2초 나타났다가 해제된다', async () => {
  const context = await launchWithExtension();
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();

    // onInstalled 초기화가 pet 을 쓸 때까지 대기(다른 스펙과 동일한 레이스 방지 패턴).
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

    await page.goto('data:text/html,<html><body><h1>eat test</h1></body></html>');

    const overlay = page.locator(OVERLAY_SELECTOR);
    await expect(overlay).toHaveCount(1, { timeout: 5000 });

    // ── ① 지면 안착 대기 ──────────────────────────────────────────────
    // eating 트리거는 content 에서 지면 상태(!falling, !held, !dragging)에서만 발동한다.
    // 상단에서 낙하 시작하므로 먼저 바닥 근처로 수렴할 때까지 기다린다.
    const groundY = await page.evaluate((h) => window.innerHeight - h, SPRITE_H);
    await expect
      .poll(async () => overlay.evaluate(readTy), {
        timeout: 8000,
        intervals: [100, 200, 300, 500],
      })
      .toBeGreaterThan(groundY - 3);

    // ── ② hunger 를 높였다가(prevHunger 갱신) 낮춘다(먹이 흉내) ─────────────
    // content 의 onChanged 는 pet.hunger < prevHunger 일 때만 eating 을 켠다.
    // 먼저 hunger=80 으로 올려 content 의 prevHunger 를 80 으로 만든 뒤,
    // 잠시 후 hunger=20 으로 내리면 감소가 감지되어 eating(2초)이 시작된다.
    await sw.evaluate(async () => {
      await chrome.storage.local.set({ pet: { hunger: 80, happiness: 50, lastUpdated: Date.now() } });
    });
    // onChanged 가 content 에 도달해 prevHunger 를 갱신할 여유를 준다.
    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet.hunger), {
        timeout: 2000,
      })
      .toBe(80);

    await sw.evaluate(async () => {
      await chrome.storage.local.set({ pet: { hunger: 20, happiness: 50, lastUpdated: Date.now() } });
    });

    // ── ③ eating 프레임(-512px)이 나타나는지 폴링 ─────────────────────────
    // eating 은 spriteFrame 우선순위상 falling/held 다음(mood 무관)이라 즉시 -512px 로 잡힌다.
    // 트리거~프레임 반영은 rAF 한 두 프레임 내라 짧은 timeout 으로 충분하다.
    await expect
      .poll(async () => overlay.evaluate((el) => getComputedStyle(el).backgroundPositionX), {
        timeout: 1500,
        intervals: [50, 50, 100, 100, 200],
      })
      .toBe(EAT_BG_POS_X);

    // ── ④ EAT_MS 후 eating 해제 → 더 이상 -512px 아님 ────────────────────
    // 해제되면 falling→walking 으로 물리 재개. eat 프레임은 eating 모드에서만 나오므로
    // EAT_MS 경과 뒤엔 background-position-x 가 -512px 를 벗어난다.
    await expect
      .poll(async () => overlay.evaluate((el) => getComputedStyle(el).backgroundPositionX), {
        timeout: EAT_MS + 2000,
        intervals: [200, 200, 300, 500],
      })
      .not.toBe(EAT_BG_POS_X);

    // ── ⑤ 콘솔 에러 0건 + 전역 __errors 비어있음 ─────────────────────────
    expect(consoleErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
