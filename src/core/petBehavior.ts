// 웹페이지 위 팻의 물리·행동 상태머신 (순수 함수, DOM·크롬 API 의존 없음)

export type PetMode = 'idle' | 'walking' | 'falling' | 'perched' | 'held';

/** px, 뷰포트 좌표 */
export interface Vec {
  x: number;
  y: number;
}

/** facing 1=오른쪽, -1=왼쪽. pos 는 스프라이트 좌상단 기준. clock 은 ms 누적(주기 산출용). */
export interface PetBody {
  pos: Vec;
  vel: Vec;
  mode: PetMode;
  facing: 1 | -1;
  clock: number;
}

export interface Env {
  viewport: { width: number; height: number };
  /** 팻 top 이 바닥에 닿을 때의 y (뷰포트 하단 - SPRITE_H). */
  ground: number;
  /** 루프 B 에서 사용. 이번 루프에서는 항상 null 로 가정하고 무시한다. */
  perch?: { top: number; left: number; right: number } | null;
}

/** 배고픔·행복도 (0~100). petState 와 값 범위 일치. */
export interface Mood {
  hunger: number;
  happiness: number;
}

/** 스프라이트 한 프레임의 px 크기(세로 3:4). content 계층이 import 해 오버레이 크기로 쓴다. */
export const SPRITE_W = 64;
export const SPRITE_H = 104;

/** 중력 가속도 (px/s^2). */
export const G = 2000;

/** 건강한 팻의 기본 걷기 속도 (px/s). */
export const WALK_SPEED = 60;

/** 걷기 프레임 교대 보폭 (px). 이 거리마다 walk1↔walk2 교대 → 짧아서 다리 놀림이 빨라 보인다. */
export const WALK_STRIDE = 14;

/** perch(요소) 위로 올라갈 때의 상승 속도 (px/s). */
export const CLIMB_SPEED = 120;

/** 지면에서 한 주기 중 걷는 시간 (ms). 튜닝 가능. */
export const WALK_MS = 2500;

/** 지면에서 한 주기 중 멈춰 표정 짓는 시간 (ms). 튜닝 가능. */
export const IDLE_MS = 1200;

/**
 * mood 를 걷기 속도 배율(0.4~1.0)로 환산한다.
 * 배고프거나(hunger↑) 불행하면(happiness↓) 느려진다.
 * 건강도 = ((100-hunger) + happiness) / 200 → 0~1. 이를 [0.4, 1.0] 로 선형 사상.
 */
function speedFactor(mood: Mood): number {
  const health = ((100 - mood.hunger) + mood.happiness) / 200;
  return 0.4 + 0.6 * health;
}

/**
 * 한 프레임 진행. dt·상태만으로 계산하는 결정적 순수 함수.
 * Math.random()·Date.now() 를 쓰지 않는다. 입력 body 는 변형하지 않는다.
 * perch 는 이번 루프에서 무시한다(루프 B).
 */
export function step(body: PetBody, env: Env, mood: Mood, dtMs: number): PetBody {
  // held: 커서로 잡혀 있는 동안엔 물리를 멈춘다. 위치는 content 가 커서로 직접 세팅하므로
  // step 은 body 를 그대로 반환(identity)한다. falling/perch/gravity 보다 먼저 검사한다.
  if (body.mode === 'held') return body;

  const dt = dtMs / 1000;
  const clock = body.clock + dtMs;
  const { ground, viewport, perch } = env;

  if (perch == null) {
    // perch 사라짐: 앉아 있었다면 vy=0 에서 낙하 시작.
    if (body.mode === 'perched') {
      return {
        pos: { x: body.pos.x, y: body.pos.y },
        vel: { x: 0, y: 0 },
        mode: 'falling',
        facing: body.facing,
        clock,
      };
    }
    // 그 외는 기존 A 동작(아래 낙하/걷기)로 흐른다.
  } else {
    const perchTopY = perch.top - SPRITE_H;
    const minX = perch.left;
    const maxX = Math.max(perch.left, perch.right - SPRITE_W);
    const speed = WALK_SPEED * speedFactor(mood);

    if (body.mode === 'perched') {
      // 요소 위에 앉음: perch.top 을 매 프레임 추종(스크롤 시 함께 이동) + 좌우 배회.
      const vx = speed * body.facing;
      let x = body.pos.x + vx * dt;
      let facing = body.facing;
      if (x > maxX) {
        x = maxX;
        facing = -1;
      } else if (x < minX) {
        x = minX;
        facing = 1;
      }
      return {
        pos: { x, y: perchTopY },
        vel: { x: vx, y: 0 },
        mode: 'perched',
        facing,
        clock,
      };
    }

    const aligned = body.pos.x >= minX && body.pos.x <= maxX;
    if (!aligned) {
      // perch 아래로 정렬되도록 지면에서 중심 쪽으로 걷는다(y 는 현 지면 유지).
      const center = (perch.left + perch.right) / 2;
      const facing: 1 | -1 = center >= body.pos.x + SPRITE_W / 2 ? 1 : -1;
      const vx = speed * facing;
      const x = body.pos.x + vx * dt;
      return {
        pos: { x, y: ground },
        vel: { x: vx, y: 0 },
        mode: 'walking',
        facing,
        clock,
      };
    }

    if (body.pos.y > perchTopY) {
      // 정렬됨: 요소 위로 상승(climb).
      const y = body.pos.y - CLIMB_SPEED * dt;
      if (y <= perchTopY) {
        return {
          pos: { x: body.pos.x, y: perchTopY },
          vel: { x: 0, y: 0 },
          mode: 'perched',
          facing: body.facing,
          clock,
        };
      }
      return {
        pos: { x: body.pos.x, y },
        vel: { x: 0, y: -CLIMB_SPEED },
        mode: 'walking',
        facing: body.facing,
        clock,
      };
    }
    // 정렬됐고 이미 perchTopY 이하 → 아래 기존 로직으로(안착 처리 다음 프레임).
  }

  // 공중에 있거나 이미 낙하 중이면 중력 적용.
  if (body.pos.y < ground || body.mode === 'falling') {
    const vy = body.vel.y + G * dt;
    const y = body.pos.y + vy * dt;

    if (y >= ground) {
      // 착지 → walking
      return {
        pos: { x: body.pos.x, y: ground },
        vel: { x: 0, y: 0 },
        mode: 'walking',
        facing: body.facing,
        clock,
      };
    }

    return {
      pos: { x: body.pos.x, y },
      vel: { x: body.vel.x, y: vy },
      mode: 'falling',
      facing: body.facing,
      clock,
    };
  }

  // 지면 위 → 걷기/멈춤 주기.
  const phase = clock % (WALK_MS + IDLE_MS);
  if (phase >= WALK_MS) {
    // idle 구간: 멈춰서 표정 짓는다. pos.x 유지.
    return {
      pos: { x: body.pos.x, y: ground },
      vel: { x: 0, y: 0 },
      mode: 'idle',
      facing: body.facing,
      clock,
    };
  }

  // walk 구간: 이동, 끝에서 facing 반전.
  const speed = WALK_SPEED * speedFactor(mood);
  const vx = speed * body.facing;
  let x = body.pos.x + vx * dt;
  let facing = body.facing;

  const maxX = viewport.width - SPRITE_W;
  if (x > maxX) {
    x = maxX;
    facing = -1;
  } else if (x < 0) {
    x = 0;
    facing = 1;
  }

  return {
    pos: { x, y: ground },
    vel: { x: vx, y: 0 },
    mode: 'walking',
    facing,
    clock,
  };
}

/**
 * 모드·mood 로 스프라이트 프레임 키를 반환한다. content 가 이 키로 프레임을 고른다.
 * 프레임 키 후보: 'idle' | 'walk1' | 'walk2' | 'fall' | 'happy' | 'hungry'
 * 우선순위(이동 애니메이션이 mood 표정보다 우선 → 표정은 멈췄을 때만):
 *   1) falling → 'fall'
 *   2) walking → pos.x 를 WALK_STRIDE 로 나눈 셀 기준 walk1/walk2 번갈아(결정적)
 *   3) 멈춤(idle·perched 등): hunger 높음(>=70) → 'hungry'
 *   4) 멈춤: happiness 높음(>=90) 이고 배 안 고픔 → 'happy'
 *   5) 그 외 → 'idle'
 */
export function spriteFrame(body: PetBody, mood: Mood): string {
  if (body.mode === 'falling') return 'fall';
  // held: 잡혀 있을 땐 걷기/표정 대신 idle 프레임. (held 전용 프레임은 아트 생기면 매핑)
  if (body.mode === 'held') return 'idle';
  if (body.mode === 'walking') {
    // WALK_STRIDE(짧은 보폭) 단위로 프레임을 번갈아 → 이동 속도에 다리 놀림이 연동(결정적).
    const phase = Math.floor(body.pos.x / WALK_STRIDE) % 2;
    return phase === 0 ? 'walk1' : 'walk2';
  }
  // 멈춘 상태(idle·perched)에서만 기분 표정.
  if (mood.hunger >= 70) return 'hungry';
  if (mood.happiness >= 90) return 'happy';
  return 'idle';
}
