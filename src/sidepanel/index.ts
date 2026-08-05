// side panel 진입점 — 저장된 팻 상태를 게이지/성장 UI로 렌더링하고 먹이·대화를 배선한다
import { chat, createPet, decay, feed, levelFromXp, type PetState } from '../core/petState';
import { loadPet } from '../chrome/storage';
import { isExtensionContextValid } from '../chrome/context';

// 확장이 갱신되면 이 패널은 죽은 컨텍스트를 참조한다. 매번 실패를 콘솔에 뿜는 대신
// 한 번만 안내하고 먹이 버튼을 잠근다. 패널을 다시 열면 새 컨텍스트로 복구된다.
let noticeShown = false;
function showContextInvalidNotice(): void {
  if (noticeShown) return;
  noticeShown = true;
  const pet = document.getElementById('pet');
  if (pet) pet.textContent = '🔄';
  const btn = document.getElementById('feed') as HTMLButtonElement | null;
  if (btn) {
    btn.textContent = '확장이 갱신됨 — 패널을 다시 열어주세요';
    btn.disabled = true;
  }
  console.warn('확장 컨텍스트 무효화 — side panel 을 다시 열면 복구됩니다');
}

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
  const xp = Math.max(0, pet.xp ?? 0);
  const level = Math.max(1, pet.level ?? levelFromXp(xp));
  const bond = Math.round(Math.min(100, Math.max(0, pet.bond ?? 0)));
  const chatCount = Math.max(0, pet.chatCount ?? 0);
  const levelVal = document.getElementById('level-val');
  const bondVal = document.getElementById('bond-val');
  const xpVal = document.getElementById('xp-val');
  const chatCountVal = document.getElementById('chat-count-val');
  if (levelVal) levelVal.textContent = String(level);
  if (bondVal) bondVal.textContent = String(bond);
  if (xpVal) xpVal.textContent = `${xp} XP`;
  if (chatCountVal) chatCountVal.textContent = String(chatCount);
}

async function render(): Promise<void> {
  if (!isExtensionContextValid()) {
    showContextInvalidNotice();
    return;
  }
  try {
    const pet = (await loadPet()) ?? createPet(Date.now());
    paint(pet);
  } catch (err) {
    console.error('팻 상태 렌더 실패', err);
  }
}

async function handleFeed(): Promise<void> {
  if (!isExtensionContextValid()) {
    showContextInvalidNotice();
    return;
  }
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

async function handleChat(message: string): Promise<void> {
  if (!isExtensionContextValid()) {
    showContextInvalidNotice();
    return;
  }
  try {
    const now = Date.now();
    // 대화도 storage 단일 진실을 매번 새로 읽은 뒤, 먼저 감쇠를 반영해 현재 상태에서 성장시킨다.
    const current = (await loadPet()) ?? createPet(now);
    const result = chat(decay(current, now), message);
    await chrome.storage.local.set({ pet: result.state, chattedAt: Date.now() });
    const reply = document.getElementById('chat-reply');
    if (reply) reply.textContent = result.reply;
    paint(result.state);
  } catch (err) {
    console.error('대화 처리 실패', err);
  }
}

const feedButton = document.getElementById('feed');
feedButton?.addEventListener('click', () => void handleFeed());

const chatForm = document.getElementById('chat-form') as HTMLFormElement | null;
const chatInput = document.getElementById('chat-input') as HTMLInputElement | null;
chatForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = chatInput?.value ?? '';
  if (chatInput) chatInput.value = '';
  void handleChat(message);
});

// 알람 감쇠·외부 먹이 등 storage 'pet' 키가 바뀌면 즉시 다시 렌더(실시간 갱신).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.pet) return;
  const next = changes.pet.newValue as PetState | undefined;
  if (next) paint(next);
  else void render();
});

void render();
