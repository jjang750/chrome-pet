// side panel 진입점 — 저장된 팻 상태를 게이지로 렌더링하고 먹이 주기·실시간 갱신을 배선한다
import { createPet, decay, feed, type PetState } from '../core/petState';
import { CHARACTERS, resolveCharacter } from '../core/characters';
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

const feedButton = document.getElementById('feed');
feedButton?.addEventListener('click', () => void handleFeed());

/** 선택 상태 표시를 저장된 id 기준으로 맞춘다(aria-pressed 가 곧 선택 표시). */
function paintCharacterSelection(id: string | undefined): void {
  const selected = resolveCharacter(id).id;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.char-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.characterId === selected));
  }
}

async function selectCharacter(id: string): Promise<void> {
  if (!isExtensionContextValid()) {
    showContextInvalidNotice();
    return;
  }
  try {
    // 캐릭터는 팻의 생체 상태(pet)와 무관한 표시 설정이라 별도 키로 저장한다.
    await chrome.storage.local.set({ character: id });
    // onChanged 도 발화하지만 즉각 반영을 위해 직접 갱신.
    paintCharacterSelection(id);
  } catch (err) {
    console.error('캐릭터 선택 실패', err);
  }
}

/** CHARACTERS 목록으로 썸네일 버튼을 만든다. 썸네일은 시트의 idle 프레임(인덱스 0). */
function buildCharacterPicker(): void {
  const host = document.getElementById('characters');
  if (!host) return;
  for (const character of CHARACTERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'char-btn';
    btn.dataset.characterId = character.id;
    btn.setAttribute('aria-pressed', 'false');

    const thumb = document.createElement('div');
    thumb.className = 'char-thumb';
    thumb.style.backgroundImage = `url(${chrome.runtime.getURL(character.sprite)})`;

    const name = document.createElement('span');
    name.className = 'char-name';
    name.textContent = character.name;

    btn.append(thumb, name);
    btn.addEventListener('click', () => void selectCharacter(character.id));
    host.appendChild(btn);
  }
}

// 알람 감쇠·외부 먹이 등 storage 'pet' 키가 바뀌면 즉시 다시 렌더(실시간 갱신).
// 다른 창의 패널에서 캐릭터를 바꿨을 때도 선택 표시를 따라간다.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.character) {
    paintCharacterSelection(changes.character.newValue as string | undefined);
  }
  if (!changes.pet) return;
  const next = changes.pet.newValue as PetState | undefined;
  if (next) paint(next);
  else void render();
});

buildCharacterPicker();
void chrome.storage.local
  .get('character')
  .then((result) => paintCharacterSelection(result.character as string | undefined))
  .catch((err) => console.error('캐릭터 선택 로드 실패', err));

void render();
