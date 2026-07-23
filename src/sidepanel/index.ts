// side panel 진입점 — 저장된 팻 상태를 게이지로 렌더링하고 먹이 주기·실시간 갱신을 배선한다
import { createPet, decay, feed, type PetState } from '../core/petState';
import { loadPet } from '../chrome/storage';

/** 진행바 채움과 숫자 라벨을 상태 값(0~100)에 맞춰 갱신한다. */
function renderGauge(fillId: string, valId: string, trackSel: string, value: number): void {
  const rounded = Math.round(value);
  const fill = document.getElementById(fillId);
  const val = document.getElementById(valId);
  if (fill) fill.style.width = `${rounded}%`;
  if (val) val.textContent = String(rounded);
  const track = document.querySelector(trackSel);
  if (track) track.setAttribute('aria-valuenow', String(rounded));
}

function paint(pet: PetState): void {
  renderGauge('hunger-fill', 'hunger-val', '.gauge-track[aria-label="배고픔"]', pet.hunger);
  renderGauge('happy-fill', 'happy-val', '.gauge-track[aria-label="행복"]', pet.happiness);
}

async function render(): Promise<void> {
  try {
    const pet = (await loadPet()) ?? createPet(Date.now());
    paint(pet);
  } catch (err) {
    console.error('팻 상태 렌더 실패', err);
  }
}

async function handleFeed(): Promise<void> {
  try {
    const now = Date.now();
    // 상태의 단일 진실은 chrome.storage — 매번 새로 읽는다(메모리 보관 금지).
    const current = (await loadPet()) ?? createPet(now);
    // 먹이 전 시계 최신화로 감쇠 누락 방지 후 먹이 적용.
    const fed = feed(decay(current, now));
    // pet 과 fedAt 을 한 번에 저장. fedAt 은 매 클릭마다 바뀌는 신호로,
    // content 가 이 변화를 감지해 배고픔과 무관하게 eat 애니메이션을 트리거한다.
    await chrome.storage.local.set({ pet: fed, fedAt: Date.now() });
    // storage.onChanged 도 발화하지만, 즉각 반영을 위해 직접 다시 그린다.
    await render();
  } catch (err) {
    console.error('먹이 주기 실패', err);
  }
}

const feedButton = document.getElementById('feed');
feedButton?.addEventListener('click', () => void handleFeed());

// 알람 감쇠·외부 먹이 등 storage 'pet' 키가 바뀌면 즉시 다시 렌더(실시간 갱신).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.pet) return;
  const next = changes.pet.newValue as PetState | undefined;
  if (next) paint(next);
  else void render();
});

void render();
