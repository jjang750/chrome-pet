// 알람 등록 E2E — pet-tick 알람이 주기 1분으로 정확히 1건(멱등) 등록되고 전역 에러 0건 확인
import { test, expect } from '@playwright/test';
import { launchWithExtension } from './harness';

test('pet-tick 알람이 주기 1분으로 중복 없이 정확히 1건 등록된다', async () => {
  const context = await launchWithExtension();
  try {
    // service worker 기동 대기
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();

    // onInstalled 의 ensurePetTickAlarm() 이 알람을 등록할 때까지 기다린다.
    // 등록은 비동기라 착지 전에 읽으면 null 이 나오는 레이스가 있으므로 poll 로 착지를 대기한다.
    // (feed.spec 의 "pet 키 존재 폴링" 패턴을 알람 등록 착지 대기에 맞춰 적용)
    await expect
      .poll(
        async () => sw.evaluate(async () => (await chrome.alarms.get('pet-tick')) != null),
        { timeout: 5000 },
      )
      .toBe(true);

    // pet-tick 알람이 존재하고 주기가 1분이다.
    const alarm = await sw.evaluate(async () => chrome.alarms.get('pet-tick'));
    expect(alarm).toBeTruthy();
    expect(alarm.name).toBe('pet-tick');
    expect(alarm.periodInMinutes).toBe(1);

    // 멱등성: onInstalled/onStartup 이 같은 이름으로 재호출해도 중복 등록되지 않는다.
    // 전체 알람 중 name==='pet-tick' 이 정확히 1건이어야 한다.
    const petTickCount = await sw.evaluate(async () => {
      const all = await chrome.alarms.getAll();
      return all.filter((a) => a.name === 'pet-tick').length;
    });
    expect(petTickCount).toBe(1);

    // 전역 에러 기록이 없어야 한다
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
