// 낮잠 회귀 E2E — 오버레이가 한 번 잠들고 깨어도 storage.pet 의 배고픔이 줄지 않음을 검증
// (버그: 애니메이션 주기 38.6초마다 rest() 가 배고픔을 -20 해 decay(+10/시간)를 186배 압도 → 영구 0 고정)
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension, gotoLocalPage } from './harness';
import { WALK_MS, IDLE_MS, SLEEP_MS, SLEEP_EVERY, SPRITE_W } from '../../src/core/petBehavior';

const OVERLAY_SELECTOR = 'div[style*="pet.png"]';

// content 의 FRAME_INDEX 에서 sleep 프레임 인덱스. 잠든 프레임은 backgroundPositionX 로 관측된다.
const SLEEP_FRAME_INDEX = 7;
const SLEEP_BG_X = `${-SLEEP_FRAME_INDEX * SPRITE_W}px`;

// super-cycle = (SLEEP_EVERY-1)개의 일반 cycle + walk + sleep. 첫 낮잠은 이 주기 끝에서 일어난다.
const SUPER_CYCLE_MS = (SLEEP_EVERY - 1) * (WALK_MS + IDLE_MS) + WALK_MS + SLEEP_MS;

// 첫 잠·깸을 확실히 지나도록 여유를 둔다. rAF 는 활성 탭에서만 진행하므로 페이지를 앞에 두고 기다린다.
const OBSERVE_MS = SUPER_CYCLE_MS + 5_000;

// 주입 배고픔. hungry 프레임 임계(70) 아래로 둬야 잠든 동안 sleep 프레임이 나온다.
const INJECTED_HUNGER = 50;

test('낮잠에서 깨어도 배고픔이 회복되지 않는다', async () => {
  test.setTimeout(OBSERVE_MS + 60_000);

  const context = await launchWithExtension();
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();

    // onInstalled 초기화가 pet 을 쓸 때까지 먼저 기다린다(주입값이 덮어써지는 레이스 방지).
    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet != null))
      .toBe(true);

    // lastUpdated 를 현재로 맞춰 pet-tick decay 가 큰 폭으로 튀지 않게 한다.
    await sw.evaluate(async (hunger) => {
      await chrome.storage.local.set({
        pet: { hunger, happiness: 50, lastUpdated: Date.now() },
        __errors: [],
      });
    }, INJECTED_HUNGER);

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await gotoLocalPage(page, '<!doctype html><title>sleep</title><body><p>pet sleep test</p></body>');

    // 오버레이가 실제로 주입돼 렌더 루프가 도는지 먼저 확인(안 돌면 이 테스트는 무의미).
    const overlay = page.locator(OVERLAY_SELECTOR);
    await expect(overlay).toBeAttached();
    await page.bringToFront();

    // 한 super-cycle 이상 관측하며 (1) 배고픔이 주입값 미만으로 내려가지 않는지,
    // (2) 실제로 sleep 프레임이 한 번이라도 나왔는지 함께 수집한다.
    // 낮잠 회복이 되살아나면 (1)에서 즉시 실패한다.
    const deadline = Date.now() + OBSERVE_MS;
    let sawSleepFrame = false;
    while (Date.now() < deadline) {
      const hunger = (await sw.evaluate(
        async () => (await chrome.storage.local.get('pet')).pet.hunger,
      )) as number;
      expect(hunger, '낮잠 회복이 되살아나 배고픔이 감소했다').toBeGreaterThanOrEqual(INJECTED_HUNGER);
      if ((await overlay.evaluate((el) => (el as HTMLElement).style.backgroundPositionX)) === SLEEP_BG_X) {
        sawSleepFrame = true;
      }
      await page.waitForTimeout(500);
    }

    // 관측 구간에 낮잠이 없었다면 이 테스트는 회귀를 잡을 수 없다 → 통과로 위장되지 않게 실패시킨다.
    expect(sawSleepFrame, '관측 구간에 sleep 프레임이 없었다 — 테스트가 회귀를 잡지 못한다').toBe(true);

    expect(consoleErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
