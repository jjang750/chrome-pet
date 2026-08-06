// 팻의 배고픔·행복도 상태머신 (순수 함수, 크롬 API 의존 없음)

/** 팻 상태의 단일 진실 공급원 형태. 저장 시 chrome.storage.local 에 이 형태로 직렬화된다. */
export interface PetState {
  /** 배고픔 0(배부름)~100(굶주림) */
  hunger: number;
  /** 행복도 0(우울)~100(행복) */
  happiness: number;
  /** 마지막으로 상태가 갱신된 시각 (epoch ms) */
  lastUpdated: number;
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
