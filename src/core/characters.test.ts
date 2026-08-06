// 캐릭터 레지스트리·id 해석 순수 로직 테스트
import { describe, it, expect } from 'vitest';
import { CHARACTERS, DEFAULT_CHARACTER_ID, resolveCharacter } from './characters';

describe('CHARACTERS', () => {
  it('선택 가능한 캐릭터가 2종 이상 있다', () => {
    expect(CHARACTERS.length).toBeGreaterThanOrEqual(2);
  });

  it('id 가 서로 겹치지 않는다', () => {
    const ids = CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('모든 캐릭터가 이름과 .png 스프라이트를 가진다', () => {
    for (const c of CHARACTERS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.sprite).toMatch(/\.png$/);
    }
  });

  it('스프라이트 파일명이 서로 겹치지 않는다', () => {
    const sprites = CHARACTERS.map((c) => c.sprite);
    expect(new Set(sprites).size).toBe(sprites.length);
  });

  it('기본 id 가 목록 안에 존재한다', () => {
    expect(CHARACTERS.some((c) => c.id === DEFAULT_CHARACTER_ID)).toBe(true);
  });
});

describe('resolveCharacter', () => {
  it('알려진 id 는 해당 캐릭터를 돌려준다', () => {
    for (const c of CHARACTERS) {
      expect(resolveCharacter(c.id)).toEqual(c);
    }
  });

  it('모르는 id·빈 문자열·undefined·null 은 기본 캐릭터로 떨어진다', () => {
    const fallback = resolveCharacter(DEFAULT_CHARACTER_ID);
    expect(resolveCharacter('없는캐릭터')).toEqual(fallback);
    expect(resolveCharacter('')).toEqual(fallback);
    expect(resolveCharacter(undefined)).toEqual(fallback);
    expect(resolveCharacter(null)).toEqual(fallback);
  });

  it('저장값이 문자열이 아니어도 기본 캐릭터로 떨어진다', () => {
    const fallback = resolveCharacter(DEFAULT_CHARACTER_ID);
    // storage 가 오염됐을 때(숫자·객체) 팻이 안 보이는 사고를 막는다.
    expect(resolveCharacter(42 as unknown as string)).toEqual(fallback);
    expect(resolveCharacter({} as unknown as string)).toEqual(fallback);
  });
});
