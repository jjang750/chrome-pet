// 선택 가능한 팻 캐릭터 목록과 저장된 id 해석 (순수 로직, 크롬 API 의존 없음)

/** 사이드패널에서 고를 수 있는 팻 캐릭터 한 종. */
export interface Character {
  /** chrome.storage 에 저장되는 안정적인 식별자. 바꾸면 기존 사용자 선택이 초기화된다. */
  id: string;
  /** 사이드패널에 표시할 이름 */
  name: string;
  /**
   * 확장 루트 기준 스프라이트 시트 파일명.
   * manifest 의 web_accessible_resources 와 scripts/build.mjs 복사 목록에 반드시 함께 등록돼야 한다.
   */
  sprite: string;
}

/**
 * 모든 시트는 64x104 셀 9프레임(idle·walk1·walk2·fall·happy·hungry·want_play·sleep·eat) 규격을 지킨다.
 * 캐릭터마다 그려진 크기는 달라도 되지만(작은 팻 허용), 셀 규격과 프레임 순서는 공통이다.
 */
export const CHARACTERS: readonly Character[] = [
  { id: 'pet', name: '분홍 고양이', sprite: 'pet.png' },
  { id: 'pet2', name: '하늘 코끼리', sprite: 'pet2.png' },
  { id: 'pet3', name: '푸들 우주인', sprite: 'pet3.png' },
];

/** 선택값이 없거나 알 수 없을 때 쓰는 캐릭터 id. */
export const DEFAULT_CHARACTER_ID = 'pet';

/**
 * 저장된 id 를 캐릭터로 해석한다. 모르는 값·비문자열이면 기본 캐릭터로 떨어진다.
 * storage 가 오염되거나 캐릭터가 목록에서 빠져도 팻이 사라지지 않게 하는 안전장치다.
 */
export function resolveCharacter(id: string | undefined | null): Character {
  const fallback = CHARACTERS.find((c) => c.id === DEFAULT_CHARACTER_ID) ?? CHARACTERS[0];
  if (typeof id !== 'string') return fallback;
  return CHARACTERS.find((c) => c.id === id) ?? fallback;
}
