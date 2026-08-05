// petState 상태머신 단위 테스트 — 시간 주입으로 재현 가능
import { describe, it, expect } from 'vitest';
import { chat, createPet, decay, feed, levelFromXp } from './petState';

const HOUR = 3_600_000;

describe('createPet', () => {
  it('초기 팻은 배부르고 행복하다', () => {
    const pet = createPet(1000);
    expect(pet).toEqual({
      hunger: 0,
      happiness: 100,
      xp: 0,
      level: 1,
      bond: 0,
      chatCount: 0,
      lastUpdated: 1000,
    });
  });
});

describe('decay', () => {
  it('1시간 경과 시 배고픔 증가·행복도 감소', () => {
    const pet = createPet(0);
    const next = decay(pet, HOUR);
    expect(next.hunger).toBe(10);
    expect(next.happiness).toBe(92);
    expect(next.lastUpdated).toBe(HOUR);
  });

  it('배고픔은 100, 행복도는 0을 넘지 않는다', () => {
    const pet = createPet(0);
    const next = decay(pet, 100 * HOUR);
    expect(next.hunger).toBe(100);
    expect(next.happiness).toBe(0);
  });

  it('시계가 역행하면 상태를 그대로 둔다', () => {
    const pet = { hunger: 50, happiness: 50, lastUpdated: 10 * HOUR };
    expect(decay(pet, 5 * HOUR)).toBe(pet);
  });
});

describe('feed', () => {
  it('배고픔은 30 감소, 행복도는 10 증가한다', () => {
    const pet = { hunger: 50, happiness: 50, lastUpdated: 5 * HOUR };
    const next = feed(pet);
    expect(next.hunger).toBe(20);
    expect(next.happiness).toBe(60);
  });

  it('lastUpdated 는 그대로 둔다', () => {
    const pet = { hunger: 50, happiness: 50, lastUpdated: 5 * HOUR };
    expect(feed(pet).lastUpdated).toBe(5 * HOUR);
  });

  it('배고픔은 0 미만으로 내려가지 않는다', () => {
    const pet = { hunger: 10, happiness: 50, lastUpdated: 0 };
    expect(feed(pet).hunger).toBe(0);
  });

  it('행복도는 100을 넘지 않는다', () => {
    const pet = { hunger: 50, happiness: 95, lastUpdated: 0 };
    expect(feed(pet).happiness).toBe(100);
  });
});

describe('주말 방치 시나리오 — decay 만으로 배고픔이 최대까지 오른다', () => {
  it('48시간 경과 시 배고픔 100, 행복도 0 에 도달한다', () => {
    const pet = { hunger: 0, happiness: 100, lastUpdated: 0 };
    const next = decay(pet, 48 * HOUR);
    expect(next.hunger).toBe(100);
    expect(next.happiness).toBe(0);
  });

  it('배고픔 최대 상태에서 feed 한 번으로는 배부름에 도달하지 않는다', () => {
    // 회복 경로는 feed 뿐이다(낮잠 등 시간 무관 회복 없음). 48시간 방치분을 되돌리려면
    // 한 번의 feed(-30)로는 부족해야 정상 — 게이지가 실제로 의미를 갖는다.
    const starved = decay({ hunger: 0, happiness: 100, lastUpdated: 0 }, 48 * HOUR);
    expect(feed(starved).hunger).toBe(70);
  });
});

describe('chat', () => {
  it('빈 메시지는 상태를 바꾸지 않고 안내 답변만 반환한다', () => {
    const pet = createPet(0);
    const result = chat(pet, '   ');
    expect(result.state).toBe(pet);
    expect(result.reply).toContain('말을 걸어주세요');
  });

  it('대화하면 경험치·레벨·친밀도·행복도가 오르고 약간 배고파진다', () => {
    const pet = { hunger: 20, happiness: 40, xp: 45, level: 1, bond: 10, chatCount: 2, lastUpdated: 0 };
    const result = chat(pet, '안녕');
    expect(result.state).toMatchObject({
      hunger: 22,
      happiness: 48,
      xp: 60,
      level: 2,
      bond: 16,
      chatCount: 3,
      lastUpdated: 0,
    });
    expect(result.reply).toContain('안녕');
  });

  it('기존 저장 데이터에 성장 필드가 없어도 기본값에서 성장시킨다', () => {
    const pet = { hunger: 0, happiness: 95, lastUpdated: 0 };
    const result = chat(pet, '좋아');
    expect(result.state).toMatchObject({ xp: 15, level: 1, bond: 6, chatCount: 1 });
  });

  it('친밀도·행복도·배고픔은 범위 안으로 clamp 된다', () => {
    const pet = { hunger: 99, happiness: 99, xp: 0, bond: 99, chatCount: 0, lastUpdated: 0 };
    const result = chat(pet, '사랑해');
    expect(result.state.hunger).toBe(100);
    expect(result.state.happiness).toBe(100);
    expect(result.state.bond).toBe(100);
  });
});

describe('levelFromXp', () => {
  it('경험치 50마다 레벨이 오른다', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(49)).toBe(1);
    expect(levelFromXp(50)).toBe(2);
    expect(levelFromXp(120)).toBe(3);
  });
});
