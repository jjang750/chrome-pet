// 팻의 배고픔·행복도 상태머신 (순수 함수, 크롬 API 의존 없음)

/** 팻 상태의 단일 진실 공급원 형태. 저장 시 chrome.storage.local 에 이 형태로 직렬화된다. */
export interface PetState {
  /** 배고픔 0(배부름)~100(굶주림) */
  hunger: number;
  /** 행복도 0(우울)~100(행복) */
  happiness: number;
  /** 대화·놀이로 쌓이는 성장 경험치 */
  xp?: number;
  /** 경험치로 계산되는 성장 레벨(1부터 시작) */
  level?: number;
  /** 팻과의 친밀도 0~100 */
  bond?: number;
  /** 누적 대화 횟수 */
  chatCount?: number;
  /** 마지막으로 상태가 갱신된 시각 (epoch ms) */
  lastUpdated: number;
}

export interface ChatResult {
  state: PetState;
  reply: string;
}

/** 시간당 배고픔 증가량 */
const HUNGER_PER_HOUR = 10;
/** 시간당 행복도 감소량 */
const HAPPINESS_PER_HOUR = 8;

const clamp = (v: number, min = 0, max = 100): number => Math.min(max, Math.max(min, v));

const XP_PER_CHAT = 15;
const BOND_PER_CHAT = 6;
const HAPPINESS_PER_CHAT = 8;
const HUNGER_PER_CHAT = 2;
const XP_PER_LEVEL = 50;

const growth = (state: PetState): Required<Pick<PetState, 'xp' | 'level' | 'bond' | 'chatCount'>> => {
  const xp = Math.max(0, state.xp ?? 0);
  return {
    xp,
    level: Math.max(1, state.level ?? levelFromXp(xp)),
    bond: clamp(state.bond ?? 0),
    chatCount: Math.max(0, state.chatCount ?? 0),
  };
};

export function levelFromXp(xp: number): number {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;
}

/** 새 팻의 초기 상태. */
export function createPet(now: number): PetState {
  return { hunger: 0, happiness: 100, xp: 0, level: 1, bond: 0, chatCount: 0, lastUpdated: now };
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
    ...state,
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
    ...state,
    hunger: clamp(state.hunger + HUNGER_PER_HOUR * elapsedHours),
    happiness: clamp(state.happiness - HAPPINESS_PER_HOUR * elapsedHours),
    lastUpdated: now,
  };
}

function replyFor(state: PetState, message: string): string {
  const lower = message.toLowerCase();
  if (state.hunger >= 70) return '배가 고파서 간식 생각이 나요… 그래도 이야기해줘서 좋아요!';
  if (state.happiness <= 30) return '조금 외로웠는데 말 걸어줘서 기운이 났어요!';
  if (lower.includes('안녕') || lower.includes('hello') || lower.includes('hi')) {
    return '안녕! 오늘도 같이 브라우저 산책해요 🐾';
  }
  if (lower.includes('사랑') || lower.includes('좋아')) return '나도 좋아해요! 친밀도가 쑥쑥 올라가요 💚';
  return '고개를 갸웃하며 열심히 들었어요. 더 이야기해줘요!';
}

/**
 * 팻에게 말을 걸면 친밀도·경험치·행복도가 오른다.
 * 입력 메시지와 현재 상태만으로 결과가 결정되는 순수 함수다.
 */
export function chat(state: PetState, message: string): ChatResult {
  const text = message.trim();
  if (!text) {
    return { state, reply: '무슨 말을 해볼까요? 짧게라도 말을 걸어주세요.' };
  }

  const g = growth(state);
  const xp = g.xp + XP_PER_CHAT;
  const next: PetState = {
    ...state,
    hunger: clamp(state.hunger + HUNGER_PER_CHAT),
    happiness: clamp(state.happiness + HAPPINESS_PER_CHAT),
    xp,
    level: levelFromXp(xp),
    bond: clamp(g.bond + BOND_PER_CHAT),
    chatCount: g.chatCount + 1,
    lastUpdated: state.lastUpdated,
  };

  return { state: next, reply: replyFor(state, text) };
}
