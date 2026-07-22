// petState 상태머신 단위 테스트 — 시간 주입으로 재현 가능
import { describe, it, expect } from 'vitest';
import { createPet, decay, feed } from './petState';

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
