// service worker 진입점 — 전역 에러를 storage 에 기록하고 팻 상태를 초기화한다
import { createPet, decay } from '../core/petState';
import { loadPet, savePet } from '../chrome/storage';

const ERRORS_KEY = '__errors';

/** 전역 에러를 storage 에 남겨 E2E 하네스가 판정할 수 있게 한다. 조용한 실패 금지. */
function recordError(message: string): void {
  chrome.storage.local.get(ERRORS_KEY).then((r) => {
    const errors = (r[ERRORS_KEY] as string[] | undefined) ?? [];
    errors.push(message);
    void chrome.storage.local.set({ [ERRORS_KEY]: errors });
  });
}

self.addEventListener('error', (e) => recordError(`error: ${e.message}`));
self.addEventListener('unhandledrejection', (e) => recordError(`unhandledrejection: ${String(e.reason)}`));

// pet-tick 주기 알람을 보장한다. 같은 이름이라 재호출해도 멱등(중복 알람 없음).
// 최소 안전 주기 1분: 버전에 따라 30초까지 허용되나 1분 미만은 클램프/경고 위험이 있어 1분으로 고정한다.
function ensurePetTickAlarm(): void {
  chrome.alarms.create('pet-tick', { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensurePetTickAlarm();
  void (async () => {
    const existing = await loadPet();
    if (!existing) await savePet(createPet(Date.now()));
  })();
});

// 브라우저 세션 시작 시에도 알람이 살아있도록 재생성한다.
chrome.runtime.onStartup.addListener(() => {
  ensurePetTickAlarm();
});

// 알람 발생 시 경과 시간만큼 상태를 감쇠시켜 저장한다.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'pet-tick') return;
  void (async () => {
    const pet = (await loadPet()) ?? createPet(Date.now());
    await savePet(decay(pet, Date.now()));
  })();
});
