// petBehavior 물리·행동 상태머신 단위 테스트 — dt·상태 주입으로 결정적 검증
import { describe, it, expect } from 'vitest';
import {
  step,
  spriteFrame,
  SPRITE_W,
  SPRITE_H,
  G,
  WALK_SPEED,
  WALK_STRIDE,
  CLIMB_SPEED,
  WALK_MS,
  IDLE_MS,
  type PetBody,
  type Env,
  type Mood,
} from './petBehavior';

const HEALTHY: Mood = { hunger: 0, happiness: 100 };

function makeEnv(width = 800, height = 600): Env {
  // ground = 팻의 발이 닿는 y(팻 top 기준). 바닥은 뷰포트 하단에서 SPRITE_H 위.
  return { viewport: { width, height }, ground: height - SPRITE_H, perch: null };
}

function bodyAt(pos: { x: number; y: number }, over: Partial<PetBody> = {}): PetBody {
  return { pos, vel: { x: 0, y: 0 }, mode: 'idle', facing: 1, clock: 0, ...over };
}

describe('상수', () => {
  it('스프라이트 크기가 export 된다', () => {
    expect(SPRITE_W).toBeGreaterThan(0);
    expect(SPRITE_H).toBeGreaterThan(0);
  });

  it('물리 상수가 export 된다', () => {
    expect(G).toBeGreaterThan(0);
    expect(WALK_SPEED).toBeGreaterThan(0);
  });
});

describe('step — 중력·낙하', () => {
  it('ground 위에 있으면 falling 이 되고 vy 가 증가한다', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 100, y: 0 }); // 공중
    const next = step(body, env, HEALTHY, 100);
    expect(next.mode).toBe('falling');
    expect(next.vel.y).toBeGreaterThan(0);
    expect(next.pos.y).toBeGreaterThan(0);
  });

  it('vy 는 G*dt 만큼 증가한다', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 100, y: 0 }, { vel: { x: 0, y: 0 } });
    const next = step(body, env, HEALTHY, 100);
    expect(next.vel.y).toBeCloseTo(G * 0.1, 5);
  });

  it('낙하가 ground 를 넘으면 ground 에 고정하고 착지→walking', () => {
    const env = makeEnv();
    // ground 바로 위에서 큰 dt 로 떨어뜨려 바닥을 넘게 한다
    const body = bodyAt({ x: 100, y: env.ground - 5 }, { mode: 'falling', vel: { x: 0, y: 500 } });
    const next = step(body, env, HEALTHY, 1000);
    expect(next.pos.y).toBe(env.ground);
    expect(next.mode).toBe('walking');
    expect(next.vel.y).toBe(0);
  });
});

describe('step — 걷기', () => {
  it('지면에서 walking 이고 vx = speed*facing', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.mode).toBe('walking');
    expect(next.vel.x).toBeGreaterThan(0);
    expect(next.pos.x).toBeGreaterThan(100);
  });

  it('facing -1 이면 왼쪽으로 이동한다', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 400, y: env.ground }, { mode: 'walking', facing: -1 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.x).toBeLessThan(400);
  });

  it('오른쪽 끝을 넘으면 facing 을 반전하고 경계 안으로 clamp', () => {
    const env = makeEnv(800);
    const maxX = env.viewport.width - SPRITE_W;
    const body = bodyAt({ x: maxX - 1, y: env.ground }, { mode: 'walking', facing: 1 });
    const next = step(body, env, HEALTHY, 1000); // 크게 이동시켜 끝을 넘게
    expect(next.facing).toBe(-1);
    expect(next.pos.x).toBeLessThanOrEqual(maxX);
  });

  it('왼쪽 끝(0)을 넘으면 facing 을 반전하고 0 으로 clamp', () => {
    const env = makeEnv(800);
    const body = bodyAt({ x: 1, y: env.ground }, { mode: 'walking', facing: -1 });
    const next = step(body, env, HEALTHY, 1000);
    expect(next.facing).toBe(1);
    expect(next.pos.x).toBeGreaterThanOrEqual(0);
  });

  it('step 은 clock 을 dtMs 만큼 누적한다', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', clock: 500 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.clock).toBe(600);
  });

  it('WALK_MS/IDLE_MS 상수가 export 된다', () => {
    expect(WALK_MS).toBeGreaterThan(0);
    expect(IDLE_MS).toBeGreaterThan(0);
  });

  it('walk 구간(phase < WALK_MS)에서는 이동하며 walking', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1, clock: 0 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.mode).toBe('walking');
    expect(next.pos.x).toBeGreaterThan(100);
  });

  it('idle 구간(phase >= WALK_MS)에서는 멈추고 mode=idle, pos.x 유지', () => {
    const env = makeEnv();
    // clock 을 walk 구간 끝 직전으로 두고 dt 를 더해 idle 구간으로 넘긴다.
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1, clock: WALK_MS - 10 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.mode).toBe('idle');
    expect(next.vel.x).toBe(0);
    expect(next.pos.x).toBe(100);
  });

  it('clock 진행에 따라 walk→idle 로 전환된다', () => {
    const env = makeEnv();
    let body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1, clock: 0 });
    // walk 구간 초반: walking
    body = step(body, env, HEALTHY, 100);
    expect(body.mode).toBe('walking');
    // WALK_MS 를 넘겨 idle 구간으로
    body = step(body, env, HEALTHY, WALK_MS);
    expect(body.mode).toBe('idle');
  });

  it('한 주기(WALK_MS+IDLE_MS)를 돌면 다시 walk 구간이다', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'idle', facing: 1, clock: WALK_MS + IDLE_MS });
    const next = step(body, env, HEALTHY, 50);
    expect(next.mode).toBe('walking');
  });
});

describe('step — mood 가 속도에 반영', () => {
  it('배고프면 건강할 때보다 느리게 걷는다', () => {
    const env = makeEnv();
    const start = { x: 100, y: env.ground };
    const healthy = step(bodyAt(start, { mode: 'walking', facing: 1 }), env, HEALTHY, 100);
    const hungry = step(
      bodyAt(start, { mode: 'walking', facing: 1 }),
      env,
      { hunger: 100, happiness: 100 },
      100,
    );
    expect(hungry.pos.x - 100).toBeLessThan(healthy.pos.x - 100);
    expect(hungry.pos.x).toBeGreaterThan(100); // 그래도 전진은 한다
  });

  it('불행하면 건강할 때보다 느리게 걷는다', () => {
    const env = makeEnv();
    const start = { x: 100, y: env.ground };
    const healthy = step(bodyAt(start, { mode: 'walking', facing: 1 }), env, HEALTHY, 100);
    const sad = step(
      bodyAt(start, { mode: 'walking', facing: 1 }),
      env,
      { hunger: 0, happiness: 0 },
      100,
    );
    expect(sad.pos.x - 100).toBeLessThan(healthy.pos.x - 100);
  });
});

describe('step — 결정성', () => {
  it('같은 입력엔 항상 같은 출력', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1 });
    const a = step(body, env, HEALTHY, 100);
    const b = step(body, env, HEALTHY, 100);
    expect(a).toEqual(b);
  });

  it('입력 body 를 변형하지 않는다(순수)', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1 });
    step(body, env, HEALTHY, 100);
    expect(body.pos).toEqual({ x: 100, y: env.ground });
    expect(body.facing).toBe(1);
  });
});

describe('상수 — perch', () => {
  it('CLIMB_SPEED 가 export 된다', () => {
    expect(CLIMB_SPEED).toBeGreaterThan(0);
  });
});

describe('step — perch(요소 안착)', () => {
  // perch 위 x 허용범위: [left, max(left, right - SPRITE_W)]
  // perchTopY = top - SPRITE_H
  function perchEnv(perch: { top: number; left: number; right: number }): Env {
    return { viewport: { width: 800, height: 600 }, ground: 600 - SPRITE_H, perch };
  }

  it('x 정렬됨 & perchTopY 아래에 있으면 상승한다(pos.y 감소)', () => {
    const perch = { top: 300, left: 200, right: 400 };
    const env = perchEnv(perch);
    const perchTopY = perch.top - SPRITE_H;
    // 범위 안 x, 지면에 있음(perchTopY 아래)
    const body = bodyAt({ x: 250, y: env.ground }, { mode: 'walking' });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.y).toBeLessThan(env.ground);
    expect(next.pos.y).toBeGreaterThanOrEqual(perchTopY);
  });

  it('상승이 perchTopY 를 넘으면 고정하고 perched 로 전환', () => {
    const perch = { top: 300, left: 200, right: 400 };
    const env = perchEnv(perch);
    const perchTopY = perch.top - SPRITE_H;
    // perchTopY 바로 아래, 큰 dt 로 넘게
    const body = bodyAt({ x: 250, y: perchTopY + 3 }, { mode: 'walking' });
    const next = step(body, env, HEALTHY, 1000);
    expect(next.pos.y).toBe(perchTopY);
    expect(next.mode).toBe('perched');
  });

  it('x 미정렬이면 지면에서 perch 중심 쪽으로 걷는다', () => {
    const perch = { top: 300, left: 500, right: 600 };
    const env = perchEnv(perch);
    // 팻이 perch 왼쪽 바깥(x=100). 중심(≈525)은 오른쪽 → 오른쪽으로 이동
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: -1 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.x).toBeGreaterThan(100); // 목표(오른쪽)로 이동
    expect(next.facing).toBe(1);
    expect(next.pos.y).toBe(env.ground); // 아직 지면 유지
    expect(next.mode).not.toBe('perched');
  });

  it('x 미정렬 — perch 가 왼쪽이면 왼쪽으로 걷는다', () => {
    const perch = { top: 300, left: 50, right: 150 };
    const env = perchEnv(perch);
    const body = bodyAt({ x: 700, y: env.ground }, { mode: 'walking', facing: 1 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.x).toBeLessThan(700);
    expect(next.facing).toBe(-1);
  });

  it('perched 중 perch=null 이면 falling 으로 전환(vy=0에서 낙하 시작)', () => {
    const env = makeEnv();
    env.perch = null;
    const body = bodyAt({ x: 250, y: 200 }, { mode: 'perched' });
    const next = step(body, env, HEALTHY, 100);
    expect(next.mode).toBe('falling');
    expect(next.vel.y).toBe(0); // vy=0 에서 낙하 시작
    expect(next.pos.y).toBe(200); // 아직 안 움직임(이번 프레임은 전환만)
    // 다음 프레임엔 중력이 붙어 가속한다
    const after = step(next, env, HEALTHY, 100);
    expect(after.vel.y).toBeGreaterThan(0);
  });

  it('perched 중 perch.top 이 바뀌면 pos.y 가 새 perchTopY 를 추종한다', () => {
    const perch = { top: 250, left: 200, right: 400 };
    const env = perchEnv(perch);
    const newPerchTopY = perch.top - SPRITE_H;
    // 이전 perchTopY(다른 값)에 앉아있던 상태
    const body = bodyAt({ x: 250, y: 100 }, { mode: 'perched', facing: 1 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.y).toBe(newPerchTopY);
    expect(next.mode).toBe('perched');
  });

  it('perched 중 x 허용범위 오른쪽 끝을 넘으면 facing 반전 & clamp', () => {
    const perch = { top: 300, left: 200, right: 400 };
    const env = perchEnv(perch);
    const perchTopY = perch.top - SPRITE_H;
    const maxX = Math.max(perch.left, perch.right - SPRITE_W); // 400-48=352
    const body = bodyAt({ x: maxX - 1, y: perchTopY }, { mode: 'perched', facing: 1 });
    const next = step(body, env, HEALTHY, 1000);
    expect(next.facing).toBe(-1);
    expect(next.pos.x).toBeLessThanOrEqual(maxX);
    expect(next.mode).toBe('perched');
  });

  it('perched 중 x 허용범위 왼쪽 끝을 넘으면 facing 반전 & clamp', () => {
    const perch = { top: 300, left: 200, right: 400 };
    const env = perchEnv(perch);
    const perchTopY = perch.top - SPRITE_H;
    const body = bodyAt({ x: perch.left + 1, y: perchTopY }, { mode: 'perched', facing: -1 });
    const next = step(body, env, HEALTHY, 1000);
    expect(next.facing).toBe(1);
    expect(next.pos.x).toBeGreaterThanOrEqual(perch.left);
  });

  it('perch 있어도 perched 아니고 x 정렬이면 상승 중에는 perched 가 아니다', () => {
    const perch = { top: 300, left: 200, right: 400 };
    const env = perchEnv(perch);
    const perchTopY = perch.top - SPRITE_H;
    // 지면(perchTopY 훨씬 아래)에서 작은 dt → 아직 도달 못 함
    const body = bodyAt({ x: 250, y: env.ground }, { mode: 'walking' });
    const next = step(body, env, HEALTHY, 10);
    expect(next.pos.y).toBeGreaterThan(perchTopY);
    expect(next.mode).not.toBe('perched');
  });

  it('perch 없으면 기존 A 동작 유지(perched 아니었으면 걷기)', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.mode).toBe('walking');
    expect(next.pos.x).toBeGreaterThan(100);
  });
});

describe('spriteFrame', () => {
  it('falling 이면 fall', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'falling' });
    expect(spriteFrame(body, HEALTHY)).toBe('fall');
  });

  it('걷는 중엔 배고파도 walk 프레임(이동 애니메이션 최우선)', () => {
    const body = bodyAt({ x: 1, y: 0 }, { mode: 'walking' });
    expect(['walk1', 'walk2']).toContain(spriteFrame(body, { hunger: 90, happiness: 100 }));
  });

  it('걷는 중엔 happiness 100이어도 walk 프레임', () => {
    const body = bodyAt({ x: 1, y: 0 }, { mode: 'walking' });
    expect(['walk1', 'walk2']).toContain(spriteFrame(body, HEALTHY));
  });

  it('멈췄을(idle) 때 배고프면 hungry', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'idle' });
    expect(spriteFrame(body, { hunger: 90, happiness: 100 })).toBe('hungry');
  });

  it('멈췄을(idle) 때 매우 행복하고 배 안 고프면 happy', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'idle' });
    expect(spriteFrame(body, { hunger: 0, happiness: 100 })).toBe('happy');
  });

  it('멈췄고 배 안 고프고 행복도 낮으면 idle', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'idle' });
    expect(spriteFrame(body, { hunger: 0, happiness: 50 })).toBe('idle');
  });

  it('걷기는 pos.x 기반으로 walk1/walk2 를 번갈아 낸다(WALK_STRIDE 기준, 결정적)', () => {
    const moodMid: Mood = { hunger: 40, happiness: 60 };
    // WALK_STRIDE 단위로 번갈아: 인접 stride 셀은 서로 다른 프레임.
    const even = bodyAt({ x: 0 * WALK_STRIDE + 1, y: 0 }, { mode: 'walking' });
    const odd = bodyAt({ x: 1 * WALK_STRIDE + 1, y: 0 }, { mode: 'walking' });
    const f1 = spriteFrame(even, moodMid);
    const f2 = spriteFrame(odd, moodMid);
    expect([f1, f2].sort()).toEqual(['walk1', 'walk2']);
  });

  it('인접한 두 stride 셀은 서로 다른 walk 프레임을 낸다', () => {
    const moodMid: Mood = { hunger: 40, happiness: 60 };
    const a = spriteFrame(bodyAt({ x: 3 * WALK_STRIDE + 2, y: 0 }, { mode: 'walking' }), moodMid);
    const b = spriteFrame(bodyAt({ x: 4 * WALK_STRIDE + 2, y: 0 }, { mode: 'walking' }), moodMid);
    expect(a).not.toBe(b);
  });

  it('같은 stride 셀 안에서는 동일한 walk 프레임을 낸다', () => {
    const moodMid: Mood = { hunger: 40, happiness: 60 };
    const lo = spriteFrame(bodyAt({ x: 2 * WALK_STRIDE + 0, y: 0 }, { mode: 'walking' }), moodMid);
    const hi = spriteFrame(
      bodyAt({ x: 2 * WALK_STRIDE + (WALK_STRIDE - 1), y: 0 }, { mode: 'walking' }),
      moodMid,
    );
    expect(lo).toBe(hi);
  });
});
