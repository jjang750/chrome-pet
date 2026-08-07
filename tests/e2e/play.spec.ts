// 놀아주기 E2E — 팻을 클릭/드래그해 놓으면 행복도가 오르고, 쿨다운 안 연타는 무시되는지 확인
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension, gotoLocalPage } from './harness';

const SPRITE_H = 104;

// core/petState 의 상수 미러링.
const HAPPINESS_PER_PLAY = 8;
const PLAY_COOLDOWN_MS = 3000;

const OVERLAY_SELECTOR = 'div[style*="pet.png"], div[style*="pet2.png"]';

function readTy(el: Element): number {
  const t = getComputedStyle(el).transform;
  if (t === 'none') return 0;
  const m = /matrix\(([^)]+)\)/.exec(t);
  if (!m) return 0;
  return parseFloat(m[1].split(',')[5].trim());
}

test('팻을 클릭하면 행복도가 오르고, 쿨다운 안 연타는 무시된다', async () => {
  const context = await launchWithExtension();
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();

    // onInstalled 초기화가 정착한 뒤 시작(다른 스펙과 동일한 레이스 방지 패턴).
    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet != null), {
        timeout: 5000,
      })
      .toBe(true);

    // 행복도 50 으로 주입 — 100 이면 clamp 로 변화가 안 보인다.
    // lastPlayedAt 을 빼고 넣어 "기능 추가 전 저장 상태"도 첫 클릭에 반응하는지 함께 본다.
    await sw.evaluate(async () => {
      await chrome.storage.local.set({
        pet: { hunger: 20, happiness: 50, lastUpdated: Date.now() },
        __errors: [],
      });
    });

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await gotoLocalPage(page, '<html><body><h1>play test</h1></body></html>');

    const overlay = page.locator(OVERLAY_SELECTOR);
    await expect(overlay).toHaveCount(1, { timeout: 5000 });

    // 지면 안착 대기 — 낙하 중엔 좌표가 계속 움직여 클릭 지점이 어긋난다.
    const groundY = await page.evaluate((h) => window.innerHeight - h, SPRITE_H);
    await expect
      .poll(async () => overlay.evaluate(readTy), { timeout: 8000, intervals: [100, 200, 300, 500] })
      .toBeGreaterThan(groundY - 3);

    // decay 가 놀기 직전에 먼저 돌아 경과 초 단위로 소수점이 붙는다(정상).
    // 놀아주기 증가분(+8)만 보면 되므로 정수로 반올림해 비교한다.
    const happiness = async (): Promise<number> =>
      Math.round(
        await sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet.happiness),
      );
    expect(await happiness()).toBe(50);

    // ── ① 클릭 1회 → 행복도 +8 ────────────────────────────────────────
    // 팻은 계속 걸어다니므로 좌표를 그때그때 잡아 클릭한다(force: 이동 중 hit-test 흔들림 회피).
    await overlay.click({ force: true });
    await expect.poll(happiness, { timeout: 3000 }).toBe(50 + HAPPINESS_PER_PLAY);

    // ── ② 쿨다운 안에 연타 → 변화 없음 ──────────────────────────────────
    await overlay.click({ force: true });
    await overlay.click({ force: true });
    await overlay.click({ force: true });
    // 즉시 반영되는 경로라 잠깐 기다려도 값이 유지돼야 한다.
    await page.waitForTimeout(500);
    expect(await happiness()).toBe(50 + HAPPINESS_PER_PLAY);


    // ── ③ 쿨다운 경과 후 다시 클릭 → 또 오른다 ──────────────────────────
    await page.waitForTimeout(PLAY_COOLDOWN_MS);
    await overlay.click({ force: true });
    await expect.poll(happiness, { timeout: 3000 }).toBe(50 + HAPPINESS_PER_PLAY * 2);

    // ── ④ 배고픔은 놀아주기로 변하지 않는다(행복도 전용 경로) ──────────────
    const hunger = await sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet.hunger);
    expect(hunger).toBeLessThanOrEqual(21); // decay 로 아주 조금 오를 수는 있으나 놀기로는 안 변한다

    // ── ⑤ 콘솔 에러 0건 + 전역 __errors 비어있음 ─────────────────────────
    expect(consoleErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
