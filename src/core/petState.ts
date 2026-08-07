// 팻의 배고픔·행복도 상태머신 (순수 함수, 크롬 API 의존 없음)

/** 팻 상태의 단일 진실 공급원 형태. 저장 시 chrome.storage.local 에 이 형태로 직렬화된다. */
export interface PetState {
  /** 배고픔 0(배부름)~100(굶주림) */
  hunger: number;
  /** 행복도 0(우울)~100(행복) */
  happiness: number;
  /** 마지막으로 상태가 갱신된 시각 (epoch ms) */
  lastUpdated: number;
  /**
   * 마지막으로 놀아준 시각 (epoch ms). 연타로 행복도를 채우는 것을 막는 쿨다운 기준.
   * 기능 추가 전에 저장된 팻엔 없으므로 optional — 없으면 곧바로 놀 수 있다.
   */
  lastPlayedAt?: number;
}

/** 시간당 배고픔 증가량 */
const HUNGER_PER_HOUR = 10;
/** 시간당 행복도 감소량 */
const HAPPINESS_PER_HOUR = 8;

const clamp = (v: number, min = 0, max = 100): number => Math.min(max, Math.max(min, v));

/** 새 팻의 초기 상태. */
export function createPet(now: number): PetState {
  return { hunger: 0, happiness: 100, lastUpdated: now };
}

/** 먹이를 주면 배고픔이 30 줄고 행복이 10 오른다(각각 clamp). */
const HUNGER_PER_FEED = 30;
const HAPPINESS_PER_FEED = 10;

/**
 * 먹이 주기. 시간 경과와 무관한 즉시 행동이므로 lastUpdated 는 그대로 둔다.
 * 순수 함수 — 같은 입력엔 항상 같은 출력.
 */
export function feed(state: PetState): PetState {
  return {
    hunger: clamp(state.hunger - HUNGER_PER_FEED),
    happiness: clamp(state.happiness + HAPPINESS_PER_FEED),
    lastUpdated: state.lastUpdated,
  };
}

/** 놀아줄 때 오르는 행복도. */
export const HAPPINESS_PER_PLAY = 8;

/**
 * 놀아주기 쿨다운 (ms). 이 안에 다시 놀면 무시된다.
 * 없으면 팻을 연타하는 것만으로 행복도가 즉시 100 이 돼 게이지가 의미를 잃는다.
 */
export const PLAY_COOLDOWN_MS = 3000;

/**
 * 놀아주기(클릭·드래그 후 놓기). 행복도만 올리고 배고픔·lastUpdated 는 건드리지 않는다.
 * 쿨다운 중이면 **받은 객체를 그대로 반환**해, 호출부가 참조 비교로 "변화 없음"을 알 수 있다.
 * now 를 주입받아 테스트 재현성을 보장한다.
 */
export function play(state: PetState, now: number): PetState {
  const elapsed = now - (state.lastPlayedAt ?? -Infinity);
  // 시계 역행(elapsed < 0)은 쿨다운으로 치지 않는다. 그러지 않으면 시계가 앞섰다 돌아온 뒤
  // 팻이 영영 반응하지 않는다.
  if (elapsed >= 0 && elapsed < PLAY_COOLDOWN_MS) return state;
  return {
    ...state,
    happiness: clamp(state.happiness + HAPPINESS_PER_PLAY),
    lastPlayedAt: now,
  };
}

/**
 * 경과 시간만큼 상태를 감쇠시킨다. now 를 인자로 받아 테스트 재현성을 보장한다.
 * now 가 lastUpdated 보다 과거면 상태를 그대로 반환한다(시계 역행 방어).
 */
export function decay(state: PetState, now: number): PetState {
  const elapsedHours = (now - state.lastUpdated) / 3_600_000;
  if (elapsedHours <= 0) return state;
  return {
    hunger: clamp(state.hunger + HUNGER_PER_HOUR * elapsedHours),
    happiness: clamp(state.happiness - HAPPINESS_PER_HOUR * elapsedHours),
    lastUpdated: now,
  };
}
