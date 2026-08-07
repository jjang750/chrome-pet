// petState 상태머신 단위 테스트 — 시간 주입으로 재현 가능
import { describe, it, expect } from 'vitest';
import { createPet, decay, feed, play, PLAY_COOLDOWN_MS } from './petState';

const HOUR = 3_600_000;

describe('createPet', () => {
  it('초기 팻은 배부르고 행복하다', () => {
    const pet = createPet(1000);
    expect(pet).toEqual({ hunger: 0, happiness: 100, lastUpdated: 1000 });
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

describe('play — 놀아주기', () => {
  it('행복도가 오르고 배고픔·lastUpdated 는 건드리지 않는다', () => {
    const pet = { hunger: 50, happiness: 50, lastUpdated: 5 * HOUR };
    const next = play(pet, 5 * HOUR);
    expect(next.happiness).toBe(58);
    expect(next.hunger).toBe(50);
    expect(next.lastUpdated).toBe(5 * HOUR);
  });

  it('놀아준 시각을 lastPlayedAt 에 기록한다', () => {
    const pet = { hunger: 0, happiness: 0, lastUpdated: 0 };
    expect(play(pet, 1234).lastPlayedAt).toBe(1234);
  });

  it('행복도는 100을 넘지 않는다', () => {
    const pet = { hunger: 0, happiness: 97, lastUpdated: 0 };
    expect(play(pet, 0).happiness).toBe(100);
  });

  it('쿨다운 안에 다시 놀면 상태가 그대로다(연타 방지)', () => {
    const pet = { hunger: 0, happiness: 50, lastUpdated: 0 };
    const first = play(pet, 10_000);
    // 같은 객체를 그대로 반환해야 호출부가 "변화 없음"을 식별할 수 있다.
    expect(play(first, 10_000 + PLAY_COOLDOWN_MS - 1)).toBe(first);
    expect(first.happiness).toBe(58);
  });

  it('쿨다운이 지나면 다시 오른다', () => {
    const pet = { hunger: 0, happiness: 50, lastUpdated: 0 };
    const first = play(pet, 10_000);
    const second = play(first, 10_000 + PLAY_COOLDOWN_MS);
    expect(second.happiness).toBe(66);
  });

  it('lastPlayedAt 이 없는 기존 저장 상태도 곧바로 놀 수 있다', () => {
    // 기능 추가 전에 저장된 팻(필드 없음)이 첫 클릭에 반응하지 않으면 버그다.
    const legacy = { hunger: 20, happiness: 40, lastUpdated: 0 };
    expect(play(legacy, 0).happiness).toBe(48);
  });

  it('시계가 역행해도 쿨다운으로 막지 않는다', () => {
    // now < lastPlayedAt 이면 경과가 음수 → 쿨다운 판정이 영구히 참이 되면 팻이 죽는다.
    const pet = { hunger: 0, happiness: 50, lastUpdated: 0, lastPlayedAt: 10 * HOUR };
    expect(play(pet, 1000).happiness).toBe(58);
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
