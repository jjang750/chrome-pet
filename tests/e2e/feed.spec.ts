// 먹이 주기 E2E — side panel 렌더 + #feed 클릭 후 수치 변화 + 콘솔/전역 에러 0건 확인
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension } from './harness';

test('먹이 주기 버튼 클릭 시 배고픔이 줄고 행복이 오르며 에러가 없다', async () => {
  const context = await launchWithExtension();
  try {
    // service worker 기동 대기 후 확장 ID 추출
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();
    const extId = new URL(sw.url()).host;

    // onInstalled 초기화(loadPet→savePet 기본값)가 storage 에 pet 을 쓸 때까지 먼저 기다린다.
    // 이걸 안 기다리고 주입하면, 뒤늦게 도착한 savePet(기본값)이 주입값을 덮어쓰는 레이스가 난다.
    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet != null))
      .toBe(true);

    // 초기화가 정착한 뒤 배고픈 상태를 주입한다(hunger 0 이면 clamp 로 변화가 안 보임).
    // 이 시점엔 pet 이 이미 존재하므로 onInstalled 의 if(!existing) 가드가 재작성을 막는다.
    await sw.evaluate(async () => {
      await chrome.storage.local.set({
        pet: { hunger: 50, happiness: 50, lastUpdated: Date.now() },
        __errors: [],
      });
    });

    // 주입이 실제로 반영됐는지 storage 를 다시 읽어 방어적으로 확인한다(레이스 재발 감지).
    const injected = await sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet);
    expect(injected.hunger).toBe(50);
    expect(injected.happiness).toBe(50);

    // side panel HTML 을 확장 페이지로 직접 연다(패널 자동 오픈은 사용자 제스처 필요).
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.goto(`chrome-extension://${extId}/sidepanel.html`);

    // #feed 버튼이 렌더된다
    const feedButton = page.locator('#feed');
    await expect(feedButton).toBeVisible();

    // 게이지 숫자 span 이 주입값(50/50)으로 렌더될 때까지 대기(정수 textContent).
    const hungerVal = page.locator('#hunger-val');
    const happyVal = page.locator('#happy-val');
    await expect
      .poll(async () => Number(await hungerVal.textContent()))
      .toBe(50);
    await expect
      .poll(async () => Number(await happyVal.textContent()))
      .toBe(50);

    // 진행바 aria-valuenow 도 주입값과 일치하는지 교차 확인.
    expect(
      Number(await page.locator('.gauge-track[aria-label="배고픔"]').getAttribute('aria-valuenow')),
    ).toBe(50);
    expect(
      Number(await page.locator('.gauge-track[aria-label="행복"]').getAttribute('aria-valuenow')),
    ).toBe(50);

    // 먹이 클릭 → decay(즉시라 경과 ~0) → feed: hunger 50-30=20, happiness 50+10=60
    // 애니메이션은 width transition 뿐이라 숫자 자체는 즉시 바뀐다. poll 로 확정 대기.
    await feedButton.click();
    await expect.poll(async () => Number(await hungerVal.textContent())).toBe(20);
    await expect.poll(async () => Number(await happyVal.textContent())).toBe(60);

    // storage 에 반영됐는지 교차 확인
    const saved = await sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet);
    expect(saved.hunger).toBeLessThan(50);
    expect(saved.happiness).toBeGreaterThan(50);

    // 실시간 갱신: 패널이 열린 상태에서 외부(SW)가 storage 의 pet 을 바꾸면
    // storage.onChanged 구독으로 새로고침 없이 숫자 span 이 갱신되는지 확인한다.
    await sw.evaluate(async () => {
      const cur = (await chrome.storage.local.get('pet')).pet;
      await chrome.storage.local.set({ pet: { ...cur, hunger: 77, happiness: 33 } });
    });
    await expect.poll(async () => Number(await hungerVal.textContent())).toBe(77);
    await expect.poll(async () => Number(await happyVal.textContent())).toBe(33);

    // 콘솔 에러 0건 + 전역 에러 기록 없음
    expect(consoleErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
