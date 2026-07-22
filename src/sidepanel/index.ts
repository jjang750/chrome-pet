// side panel 진입점 — 저장된 팻 상태를 읽어 화면에 렌더링하고 먹이 주기를 배선한다
import { createPet, decay, feed } from '../core/petState';
import { loadPet, savePet } from '../chrome/storage';

async function render(): Promise<void> {
  const pet = (await loadPet()) ?? createPet(Date.now());
  const root = document.getElementById('pet');
  if (!root) return;
  root.textContent = `🐾 배고픔 ${Math.round(pet.hunger)} · 행복 ${Math.round(pet.happiness)}`;
}

async function handleFeed(): Promise<void> {
  try {
    const now = Date.now();
    // 상태의 단일 진실은 chrome.storage — 매번 새로 읽는다(메모리 보관 금지).
    const current = (await loadPet()) ?? createPet(now);
    // 먹이 전 시계 최신화로 감쇠 누락 방지 후 먹이 적용.
    const fed = feed(decay(current, now));
    await savePet(fed);
    await render();
  } catch (err) {
    console.error('먹이 주기 실패', err);
  }
}

const feedButton = document.getElementById('feed');
feedButton?.addEventListener('click', () => void handleFeed());

void render();
