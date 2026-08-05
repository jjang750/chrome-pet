// 대화 성장 E2E — side panel 에서 팻에게 말을 걸면 성장 수치가 저장/렌더되고 콘솔/전역 에러 0건인지 확인
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension } from './harness';

test('대화 제출 시 친밀도·경험치·레벨·대화 횟수가 오르고 storage 에 저장된다', async () => {
  const context = await launchWithExtension();
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();
    const extId = new URL(sw.url()).host;

    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet != null), {
        timeout: 5000,
      })
      .toBe(true);

    await sw.evaluate(async () => {
      await chrome.storage.local.set({
        pet: {
          hunger: 20,
          happiness: 40,
          xp: 45,
          level: 1,
          bond: 10,
          chatCount: 2,
          lastUpdated: Date.now(),
        },
        __errors: [],
      });
    });

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.goto(`chrome-extension://${extId}/sidepanel.html`);

    const input = page.locator('#chat-input');
    const submit = page.locator('#chat-submit');
    await expect(input).toBeVisible();
    await expect(submit).toBeVisible();

    await expect.poll(async () => Number(await page.locator('#level-val').textContent())).toBe(1);
    await expect.poll(async () => Number(await page.locator('#bond-val').textContent())).toBe(10);
    await expect.poll(async () => await page.locator('#xp-val').textContent()).toBe('45 XP');
    await expect.poll(async () => Number(await page.locator('#chat-count-val').textContent())).toBe(2);

    await input.fill('안녕 크롬 팻');
    await submit.click();

    await expect.poll(async () => Number(await page.locator('#level-val').textContent())).toBe(2);
    await expect.poll(async () => Number(await page.locator('#bond-val').textContent())).toBe(16);
    await expect.poll(async () => await page.locator('#xp-val').textContent()).toBe('60 XP');
    await expect.poll(async () => Number(await page.locator('#chat-count-val').textContent())).toBe(3);
    await expect.poll(async () => Number(await page.locator('#hunger-val').textContent())).toBe(22);
    await expect.poll(async () => Number(await page.locator('#happy-val').textContent())).toBe(48);
    await expect(page.locator('#chat-reply')).toContainText('안녕');

    const saved = await sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet);
    expect(saved.xp).toBe(60);
    expect(saved.level).toBe(2);
    expect(saved.bond).toBe(16);
    expect(saved.chatCount).toBe(3);

    expect(consoleErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
