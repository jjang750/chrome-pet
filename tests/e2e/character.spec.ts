// 캐릭터 선택 E2E — 사이드패널 썸네일 클릭 → storage 저장 → 열려 있는 content 오버레이 시트 교체 확인
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension, gotoLocalPage } from './harness';
// 캐릭터가 늘어도 이 스펙이 깨지지 않도록 개수를 core 목록에서 파생시킨다.
// characters.ts 는 chrome API 의존이 없는 순수 모듈이라 테스트에서 그대로 import 할 수 있다.
import { CHARACTERS } from '../../src/core/characters';

// 기본 캐릭터(pet)와 두 번째 캐릭터(pet2). core/characters.ts 의 id·sprite 미러링.
const DEFAULT_SPRITE = 'pet.png';
const SECOND_ID = 'pet2';
const SECOND_SPRITE = 'pet2.png';

// 오버레이는 선택에 따라 시트가 바뀌므로 두 파일명 중 하나로 잡는다.
const OVERLAY_SELECTOR = 'div[style*="pet.png"], div[style*="pet2.png"]';

/** 오버레이의 background-image URL 에서 파일명만 뽑는다. */
function spriteFileName(el: Element): string {
  const url = getComputedStyle(el).backgroundImage;
  const m = /\/([^/"')]+\.png)/.exec(url);
  return m ? m[1] : url;
}

test('사이드패널에서 캐릭터를 고르면 storage 에 저장되고 열려 있는 팻 오버레이 시트가 즉시 바뀐다', async () => {
  const context = await launchWithExtension();
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();
    const extId = new URL(sw.url()).host;

    // onInstalled 초기화가 끝난 뒤 시작(다른 스펙과 동일한 레이스 방지 패턴).
    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet != null), {
        timeout: 5000,
      })
      .toBe(true);
    await sw.evaluate(async () => {
      await chrome.storage.local.set({ __errors: [] });
    });

    // ── ① 일반 페이지에 팻 오버레이 — 선택 전이라 기본 캐릭터 ──────────────
    const petPage = await context.newPage();
    const petErrors: string[] = [];
    petPage.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') petErrors.push(msg.text());
    });
    petPage.on('pageerror', (err) => petErrors.push(`pageerror: ${err.message}`));

    await gotoLocalPage(petPage, '<html><body><h1>character test</h1></body></html>');
    const overlay = petPage.locator(OVERLAY_SELECTOR);
    await expect(overlay).toHaveCount(1, { timeout: 5000 });
    await expect.poll(async () => overlay.evaluate(spriteFileName), { timeout: 3000 }).toBe(DEFAULT_SPRITE);

    // ── ② 사이드패널의 캐릭터 피커 렌더 확인 ────────────────────────────
    const panel = await context.newPage();
    const panelErrors: string[] = [];
    panel.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') panelErrors.push(msg.text());
    });
    panel.on('pageerror', (err) => panelErrors.push(`pageerror: ${err.message}`));

    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    const buttons = panel.locator('.char-btn');
    await expect(buttons).toHaveCount(CHARACTERS.length);

    // 선택 전에는 기본 캐릭터가 눌린 상태로 표시된다.
    const secondBtn = panel.locator(`.char-btn[data-character-id="${SECOND_ID}"]`);
    await expect(panel.locator('.char-btn[data-character-id="pet"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(secondBtn).toHaveAttribute('aria-pressed', 'false');

    // ── ③ 두 번째 캐릭터 클릭 → storage 저장 + 선택 표시 이동 ──────────────
    await secondBtn.click();
    await expect(secondBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('.char-btn[data-character-id="pet"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('character')).character))
      .toBe(SECOND_ID);

    // ── ④ 이미 열려 있던 페이지의 오버레이가 새로고침 없이 교체된다 ──────────
    // applyCharacter 는 storage.onChanged 리스너에서 직접 style 을 바꾼다(rAF 의존 없음).
    await expect.poll(async () => overlay.evaluate(spriteFileName), { timeout: 3000 }).toBe(SECOND_SPRITE);

    // ── ⑤ storage 가 오염돼도 기본 캐릭터로 떨어진다(팻이 사라지지 않는다) ────
    await sw.evaluate(async () => {
      await chrome.storage.local.set({ character: '존재하지않는캐릭터' });
    });
    await expect.poll(async () => overlay.evaluate(spriteFileName), { timeout: 3000 }).toBe(DEFAULT_SPRITE);

    // ── ⑥ 콘솔 에러 0건 + 전역 __errors 비어있음 ─────────────────────────
    expect(petErrors).toEqual([]);
    expect(panelErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
