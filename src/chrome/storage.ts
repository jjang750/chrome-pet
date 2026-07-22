// chrome.storage.local 을 팻 상태 저장소로 감싸는 얇은 어댑터 (E2E로만 검증)
import type { PetState } from '../core/petState';

const PET_KEY = 'pet';

export async function loadPet(): Promise<PetState | undefined> {
  const result = await chrome.storage.local.get(PET_KEY);
  return result[PET_KEY] as PetState | undefined;
}

export async function savePet(state: PetState): Promise<void> {
  await chrome.storage.local.set({ [PET_KEY]: state });
}
