// 스모크 E2E — service worker 기동 + 팻 상태 초기화 + 콘솔/전역 에러 0건 확인
import { test, expect } from '@playwright/test';
import { launchWithExtension } from './harness';

test('확장이 에러 없이 기동되고 팻 상태를 초기화한다', async () => {
  const context = await launchWithExtension();
  try {
    // service worker 기동 대기
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();

    // onInstalled 로 팻 상태가 저장될 시간을 준 뒤 storage 확인
    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet), {
        timeout: 5000,
      })
      .toBeTruthy();

    // 전역 에러 기록이 없어야 한다
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
