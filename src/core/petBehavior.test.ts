// petBehavior 물리·행동 상태머신 단위 테스트 — dt·상태 주입으로 결정적 검증
import { describe, it, expect } from 'vitest';
import {
  step,
  spriteFrame,
  smilePeriod,
  SPRITE_W,
  SPRITE_H,
  G,
  WALK_SPEED,
  WALK_STRIDE,
  CLIMB_SPEED,
  WALK_MS,
  IDLE_MS,
  SLEEP_EVERY,
  SLEEP_MS,
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

describe('step — perch 좁은 요소(진동 버그 수정)', () => {
  // 좁은 요소: perch.right - perch.left < SPRITE_W → 순찰 범위 붕괴(maxX<=minX).
  function perchEnv(perch: { top: number; left: number; right: number }): Env {
    return { viewport: { width: 800, height: 600 }, ground: 600 - SPRITE_H, perch };
  }

  it('좁은 요소에 perched 면 요소 중앙에 고정하고 vel.x=0(진동 없음)', () => {
    // 폭 40 < SPRITE_W(64). 중앙 = (200+240)/2 - 32 = 188
    const perch = { top: 300, left: 200, right: 240 };
    const env = perchEnv(perch);
    const perchTopY = perch.top - SPRITE_H;
    const cx = (perch.left + perch.right) / 2 - SPRITE_W / 2;
    const body = bodyAt({ x: 210, y: perchTopY }, { mode: 'perched', facing: 1 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.x).toBe(cx);
    expect(next.vel.x).toBe(0);
    expect(next.mode).toBe('perched');
    expect(next.facing).toBe(1); // facing 불변
  });

  it('좁은 요소에 perched 면 여러 step 반복해도 진동/이동 없음(facing 불변)', () => {
    const perch = { top: 300, left: 200, right: 240 };
    const env = perchEnv(perch);
    const perchTopY = perch.top - SPRITE_H;
    const cx = (perch.left + perch.right) / 2 - SPRITE_W / 2;
    let body: PetBody = bodyAt({ x: cx, y: perchTopY }, { mode: 'perched', facing: -1 });
    for (let i = 0; i < 10; i++) {
      const next = step(body, env, HEALTHY, 100);
      expect(next.pos.x).toBe(cx); // 고정
      expect(next.vel.x).toBe(0);
      expect(next.facing).toBe(-1); // 반전 없음
      expect(next.mode).toBe('perched');
      body = next;
    }
  });

  it('좁은 요소로 접근(!aligned) 시 팻 중심이 범위에 들면 상승 시작', () => {
    // 폭 40 좁은 요소. 팻 중심이 요소 가로 범위 안이면 aligned 로 인정 → 상승.
    const perch = { top: 300, left: 200, right: 240 };
    const env = perchEnv(perch);
    // pos.x=188 이면 중심 = 188+32 = 220, 이는 [200,240] 안 → aligned
    const body = bodyAt({ x: 188, y: env.ground }, { mode: 'walking' });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.y).toBeLessThan(env.ground); // 상승 시작
  });

  it('넓은 요소는 기존 순찰 유지(좌우 이동)', () => {
    const perch = { top: 300, left: 200, right: 400 }; // 폭 200 > SPRITE_W
    const env = perchEnv(perch);
    const perchTopY = perch.top - SPRITE_H;
    const body = bodyAt({ x: 250, y: perchTopY }, { mode: 'perched', facing: 1 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.x).toBeGreaterThan(250); // 이동함
    expect(next.vel.x).toBeGreaterThan(0);
  });

  it('폭이 SPRITE_W 와 정확히 같으면(maxX===minX) 중앙 고정', () => {
    const perch = { top: 300, left: 200, right: 200 + SPRITE_W };
    const env = perchEnv(perch);
    const perchTopY = perch.top - SPRITE_H;
    const cx = (perch.left + perch.right) / 2 - SPRITE_W / 2; // = perch.left
    const body = bodyAt({ x: 210, y: perchTopY }, { mode: 'perched', facing: 1 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.x).toBe(cx);
    expect(next.vel.x).toBe(0);
  });
});

describe('step — held(잡힘)', () => {
  it('held 면 body 를 그대로 반환한다(pos/vel/mode/facing/clock identity)', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 123, y: 45 }, { mode: 'held', vel: { x: 7, y: -9 }, facing: -1, clock: 500 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos).toEqual({ x: 123, y: 45 });
    expect(next.vel).toEqual({ x: 7, y: -9 });
    expect(next.mode).toBe('held');
    expect(next.facing).toBe(-1);
    expect(next.clock).toBe(500); // held 는 clock 도 누적하지 않음(완전 no-op)
  });

  it('held 면 공중에 있어도 중력이 적용되지 않는다', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 100, y: 0 }, { mode: 'held' }); // 공중
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.y).toBe(0); // 안 떨어짐
    expect(next.vel.y).toBe(0);
    expect(next.mode).toBe('held');
  });

  it('held 는 perch 가 있어도 관여하지 않는다', () => {
    const perch = { top: 300, left: 200, right: 400 };
    const env: Env = { viewport: { width: 800, height: 600 }, ground: 600 - SPRITE_H, perch };
    const body = bodyAt({ x: 250, y: 100 }, { mode: 'held' });
    const next = step(body, env, HEALTHY, 100);
    expect(next.mode).toBe('held');
    expect(next.pos).toEqual({ x: 250, y: 100 });
  });
});

describe('step — eating(먹이)', () => {
  it('eating 이면 body 를 그대로 반환한다(no-op, held 와 동일 패턴)', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 200, y: 300 }, { mode: 'eating', vel: { x: 3, y: -2 }, facing: -1, clock: 700 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos).toEqual({ x: 200, y: 300 });
    expect(next.vel).toEqual({ x: 3, y: -2 });
    expect(next.mode).toBe('eating');
    expect(next.facing).toBe(-1);
    expect(next.clock).toBe(700); // 완전 no-op
  });

  it('eating 이면 공중에 있어도 중력이 적용되지 않는다', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 100, y: 0 }, { mode: 'eating' });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.y).toBe(0);
    expect(next.vel.y).toBe(0);
    expect(next.mode).toBe('eating');
  });
});

describe('step — playing(마우스와 놀기)', () => {
  it('playing 이면 body 를 그대로 반환한다(no-op, held/eating 과 동일 패턴)', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 321, y: 54 }, { mode: 'playing', vel: { x: 9, y: -7 }, facing: -1, clock: 800 });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos).toEqual({ x: 321, y: 54 });
    expect(next.vel).toEqual({ x: 9, y: -7 });
    expect(next.mode).toBe('playing');
    expect(next.facing).toBe(-1);
    expect(next.clock).toBe(800); // 완전 no-op, clock 미누적
  });

  it('playing 이면 공중에 있어도 중력이 적용되지 않는다', () => {
    const env = makeEnv();
    const body = bodyAt({ x: 100, y: 0 }, { mode: 'playing' });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.y).toBe(0);
    expect(next.vel.y).toBe(0);
    expect(next.mode).toBe('playing');
  });

  it('playing 은 perch 가 있어도 관여하지 않는다', () => {
    const perch = { top: 300, left: 200, right: 400 };
    const env: Env = { viewport: { width: 800, height: 600 }, ground: 600 - SPRITE_H, perch };
    const body = bodyAt({ x: 250, y: 100 }, { mode: 'playing' });
    const next = step(body, env, HEALTHY, 100);
    expect(next.mode).toBe('playing');
    expect(next.pos).toEqual({ x: 250, y: 100 });
  });

  it('playing 은 vel.x 가 있어도 content 가 세팅한 pos 를 유지한다(no-op)', () => {
    // content 가 커서로 몰며 vel.x 를 세팅해도 step 은 pos 를 건드리지 않는다.
    const env = makeEnv();
    const body = bodyAt({ x: 250, y: env.ground }, { mode: 'playing', vel: { x: 60, y: 0 } });
    const next = step(body, env, HEALTHY, 100);
    expect(next.pos.x).toBe(250);
    expect(next.mode).toBe('playing');
  });
});

describe('step — sleeping(super-cycle 낮잠)', () => {
  it('SLEEP_EVERY / SLEEP_MS 상수가 export 된다', () => {
    expect(SLEEP_EVERY).toBeGreaterThan(0);
    expect(SLEEP_MS).toBe(10000);
  });

  // super-cycle = (SLEEP_EVERY-1)번의 일반 cycle(walk+idle) + 1번의 sleep cycle(walk 후 SLEEP_MS 동안 sleeping)
  const NORMAL = WALK_MS + IDLE_MS;
  const NORMAL_SPAN = (SLEEP_EVERY - 1) * NORMAL; // super-cycle 중 일반 cycle 구간 길이
  const SUPER = NORMAL_SPAN + WALK_MS + SLEEP_MS;

  it('sleep cycle 의 walk 이후 SLEEP_MS 동안 sleeping 이 지속된다', () => {
    const env = makeEnv();
    // sleep cycle 은 super-cycle 의 마지막. walk(WALK_MS) 이후 SLEEP_MS 구간이 sleeping.
    const sleepStart = NORMAL_SPAN + WALK_MS;
    // 구간 시작·중간·거의 끝 여러 지점에서 sleeping 유지 확인
    for (const offset of [1, SLEEP_MS / 2, SLEEP_MS - 1]) {
      const clock = sleepStart + offset;
      const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1, clock });
      const next = step(body, env, HEALTHY, 0);
      expect(next.mode).toBe('sleeping');
      expect(next.vel.x).toBe(0);
      expect(next.pos.x).toBe(100); // 위치 유지
    }
  });

  it('sleep cycle 의 walk 창(phase < WALK_MS)에서는 walking 이다', () => {
    const env = makeEnv();
    const clock = NORMAL_SPAN + 100; // sleep cycle 진입 직후 walk 창
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1, clock });
    const next = step(body, env, HEALTHY, 50);
    expect(next.mode).toBe('walking');
  });

  it('일반 cycle 의 idle 창에서는 sleeping 이 아니라 idle 이다', () => {
    const env = makeEnv();
    // super-cycle 앞쪽 일반 cycle 들의 idle 창은 모두 idle
    for (let c = 0; c < SLEEP_EVERY - 1; c++) {
      const clock = c * NORMAL + WALK_MS + 10; // c번째 일반 cycle 의 idle 창
      const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1, clock });
      const next = step(body, env, HEALTHY, 0);
      expect(next.mode).toBe('idle');
    }
  });

  it('일반 cycle 의 walk 창에서는 walking 이다', () => {
    const env = makeEnv();
    const clock = 100; // 첫 일반 cycle walk 창
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1, clock });
    const next = step(body, env, HEALTHY, 50);
    expect(next.mode).toBe('walking');
  });

  it('SLEEP_MS 경과 후 다음 super-cycle 이 시작되면 다시 일반 cycle(walking)', () => {
    const env = makeEnv();
    // 정확히 한 super-cycle 뒤: 첫 일반 cycle 의 walk 창
    const clock = SUPER + 100;
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1, clock });
    const next = step(body, env, HEALTHY, 50);
    expect(next.mode).toBe('walking');
  });

  it('두 번째 super-cycle 의 sleep 구간에서도 sleeping 이다', () => {
    const env = makeEnv();
    const clock = SUPER + NORMAL_SPAN + WALK_MS + 5;
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1, clock });
    const next = step(body, env, HEALTHY, 0);
    expect(next.mode).toBe('sleeping');
  });

  it('결정적: 같은 clock 이면 항상 같은 sleeping 판정', () => {
    const env = makeEnv();
    const clock = NORMAL_SPAN + WALK_MS + 5; // sleep 구간
    const body = bodyAt({ x: 100, y: env.ground }, { mode: 'walking', facing: 1, clock });
    const a = step(body, env, HEALTHY, 0);
    const b = step(body, env, HEALTHY, 0);
    expect(a.mode).toBe('sleeping');
    expect(a).toEqual(b);
  });
});

describe('spriteFrame', () => {
  it('falling 이면 fall', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'falling' });
    expect(spriteFrame(body, HEALTHY)).toBe('fall');
  });

  it('걷는 중엔 배고파도 walk 프레임(이동 애니메이션 최우선)', () => {
    const body = bodyAt({ x: 1, y: 0 }, { mode: 'walking', vel: { x: 60, y: 0 } });
    expect(['walk1', 'walk2']).toContain(spriteFrame(body, { hunger: 90, happiness: 100 }));
  });

  it('걷는 중엔 happiness 100이어도 walk 프레임', () => {
    const body = bodyAt({ x: 1, y: 0 }, { mode: 'walking', vel: { x: 60, y: 0 } });
    expect(['walk1', 'walk2']).toContain(spriteFrame(body, HEALTHY));
  });

  it('perched 라도 좌우로 움직이면(vel.x≠0) walk 프레임', () => {
    const body = bodyAt({ x: 1, y: 0 }, { mode: 'perched', vel: { x: 60, y: 0 } });
    expect(['walk1', 'walk2']).toContain(spriteFrame(body, HEALTHY));
  });

  it('perched 라도 좌로 움직이면(vel.x<0) walk 프레임', () => {
    const body = bodyAt({ x: 1, y: 0 }, { mode: 'perched', vel: { x: -60, y: 0 } });
    expect(['walk1', 'walk2']).toContain(spriteFrame(body, { hunger: 90, happiness: 100 }));
  });

  it('walking mode 라도 vel.x===0 이면 표정 프레임(idle 등)', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'walking', vel: { x: 0, y: 0 } });
    expect(spriteFrame(body, { hunger: 0, happiness: 50 })).toBe('idle');
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
});

describe('smilePeriod — 행복할수록 자주 웃는다', () => {
  it('행복도가 높을수록 주기가 짧다(0 은 안 웃음)', () => {
    expect(smilePeriod(100)).toBe(1);
    expect(smilePeriod(90)).toBe(1);
    expect(smilePeriod(70)).toBe(2);
    expect(smilePeriod(60)).toBe(3);
    expect(smilePeriod(50)).toBe(0);
    expect(smilePeriod(0)).toBe(0);
  });

  it('행복도가 오를수록 주기가 짧아지기만 한다(역전 없음)', () => {
    // 단조성이 깨지면 "더 행복한데 덜 웃는" 구간이 생긴다.
    // 0(안 웃음)은 무한대 주기로 환산해 비교한다.
    const asPeriod = (h: number): number => smilePeriod(h) || Infinity;
    for (let h = 1; h <= 100; h++) {
      expect(asPeriod(h)).toBeLessThanOrEqual(asPeriod(h - 1));
    }
  });
});

describe('spriteFrame — 웃음 빈도', () => {
  const CYCLE = WALK_MS + IDLE_MS;
  const idleAt = (clock: number): PetBody => bodyAt({ x: 0, y: 0 }, { mode: 'idle', clock });

  it('행복도 100 이면 어느 주기에 멈춰도 웃는다', () => {
    for (let c = 0; c < 6; c++) {
      expect(spriteFrame(idleAt(c * CYCLE + 10), { hunger: 0, happiness: 100 })).toBe('happy');
    }
  });

  it('행복도 70 이면 두 주기에 한 번 웃는다', () => {
    const frames = [0, 1, 2, 3].map((c) =>
      spriteFrame(idleAt(c * CYCLE + 10), { hunger: 0, happiness: 70 }),
    );
    expect(frames).toEqual(['happy', 'idle', 'happy', 'idle']);
  });

  it('행복도 60 이면 세 주기에 한 번 웃는다', () => {
    const frames = [0, 1, 2, 3, 4, 5].map((c) =>
      spriteFrame(idleAt(c * CYCLE + 10), { hunger: 0, happiness: 60 }),
    );
    expect(frames).toEqual(['happy', 'idle', 'idle', 'happy', 'idle', 'idle']);
  });

  it('행복도가 높을수록 같은 구간에서 더 많이 웃는다', () => {
    const count = (happiness: number): number =>
      Array.from({ length: 12 }, (_, c) =>
        spriteFrame(idleAt(c * CYCLE + 10), { hunger: 0, happiness }),
      ).filter((f) => f === 'happy').length;
    expect(count(100)).toBeGreaterThan(count(70));
    expect(count(70)).toBeGreaterThan(count(60));
    expect(count(60)).toBeGreaterThan(count(50));
  });

  it('웃음 빈도보다 배고픔·낮잠·칭얼이 먼저다', () => {
    // 행복도가 높아도 배고프면 hungry 가 이긴다(기존 우선순위 유지).
    expect(spriteFrame(idleAt(0), { hunger: 90, happiness: 100 })).toBe('hungry');
    const sleeping = bodyAt({ x: 0, y: 0 }, { mode: 'sleeping', clock: 0 });
    expect(spriteFrame(sleeping, { hunger: 0, happiness: 100 })).toBe('sleep');
  });

  it('걷기는 pos.x 기반으로 walk1/walk2 를 번갈아 낸다(WALK_STRIDE 기준, 결정적)', () => {
    const moodMid: Mood = { hunger: 40, happiness: 60 };
    // WALK_STRIDE 단위로 번갈아: 인접 stride 셀은 서로 다른 프레임.
    const even = bodyAt({ x: 0 * WALK_STRIDE + 1, y: 0 }, { mode: 'walking', vel: { x: 60, y: 0 } });
    const odd = bodyAt({ x: 1 * WALK_STRIDE + 1, y: 0 }, { mode: 'walking', vel: { x: 60, y: 0 } });
    const f1 = spriteFrame(even, moodMid);
    const f2 = spriteFrame(odd, moodMid);
    expect([f1, f2].sort()).toEqual(['walk1', 'walk2']);
  });

  it('인접한 두 stride 셀은 서로 다른 walk 프레임을 낸다', () => {
    const moodMid: Mood = { hunger: 40, happiness: 60 };
    const a = spriteFrame(
      bodyAt({ x: 3 * WALK_STRIDE + 2, y: 0 }, { mode: 'walking', vel: { x: 60, y: 0 } }),
      moodMid,
    );
    const b = spriteFrame(
      bodyAt({ x: 4 * WALK_STRIDE + 2, y: 0 }, { mode: 'walking', vel: { x: 60, y: 0 } }),
      moodMid,
    );
    expect(a).not.toBe(b);
  });

  it('같은 stride 셀 안에서는 동일한 walk 프레임을 낸다', () => {
    const moodMid: Mood = { hunger: 40, happiness: 60 };
    const lo = spriteFrame(
      bodyAt({ x: 2 * WALK_STRIDE + 0, y: 0 }, { mode: 'walking', vel: { x: 60, y: 0 } }),
      moodMid,
    );
    const hi = spriteFrame(
      bodyAt(
        { x: 2 * WALK_STRIDE + (WALK_STRIDE - 1), y: 0 },
        { mode: 'walking', vel: { x: 60, y: 0 } },
      ),
      moodMid,
    );
    expect(lo).toBe(hi);
  });

  it('held 면 mood 와 무관하게 idle 프레임', () => {
    const hungry = bodyAt({ x: 0, y: 0 }, { mode: 'held' });
    expect(spriteFrame(hungry, { hunger: 90, happiness: 100 })).toBe('idle');
    const happy = bodyAt({ x: 0, y: 0 }, { mode: 'held' });
    expect(spriteFrame(happy, { hunger: 0, happiness: 100 })).toBe('idle');
  });

  it('eating 이면 mood 와 무관하게 eat 프레임', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'eating' });
    expect(spriteFrame(body, { hunger: 90, happiness: 100 })).toBe('eat');
    expect(spriteFrame(body, { hunger: 0, happiness: 100 })).toBe('eat');
  });

  it('playing 이면 happy 프레임(vel.x 가 있어도 걷기 아닌 happy)', () => {
    // content 가 커서로 몰며 vel.x 를 세팅해도 걷기 대신 happy(노는 표정).
    const body = bodyAt({ x: 1, y: 0 }, { mode: 'playing', vel: { x: 60, y: 0 } });
    expect(spriteFrame(body, HEALTHY)).toBe('happy');
  });

  it('playing 이면 mood 와 무관하게 happy(배고파도 happy)', () => {
    const body = bodyAt({ x: 1, y: 0 }, { mode: 'playing', vel: { x: 60, y: 0 } });
    expect(spriteFrame(body, { hunger: 90, happiness: 10 })).toBe('happy');
  });

  it('playing 은 falling/held/eating 보다는 아래 우선순위(playing 단독이면 happy)', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'playing', vel: { x: 0, y: 0 } });
    expect(spriteFrame(body, { hunger: 0, happiness: 50 })).toBe('happy');
  });

  it('sleeping 이면 sleep 프레임', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'sleeping' });
    expect(spriteFrame(body, { hunger: 0, happiness: 50 })).toBe('sleep');
  });

  it('sleeping 이라도 hunger>=70 이면 hungry 가 우선', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'sleeping' });
    expect(spriteFrame(body, { hunger: 80, happiness: 50 })).toBe('hungry');
  });

  it('멈췄고(idle) happiness<=30 이면 want_play (happy 보다 우선, hungry 아래)', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'idle' });
    expect(spriteFrame(body, { hunger: 0, happiness: 20 })).toBe('want_play');
  });

  it('멈췄고 hunger>=70 이면 happiness 낮아도 hungry 우선', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'idle' });
    expect(spriteFrame(body, { hunger: 90, happiness: 10 })).toBe('hungry');
  });

  it('falling 은 eating/sleeping/mood 보다 최우선 fall', () => {
    const body = bodyAt({ x: 0, y: 0 }, { mode: 'falling' });
    expect(spriteFrame(body, { hunger: 90, happiness: 10 })).toBe('fall');
  });

  it('걷는 중엔 happiness 낮아도(want_play 무관) walk 프레임', () => {
    const body = bodyAt({ x: 1, y: 0 }, { mode: 'walking', vel: { x: 60, y: 0 } });
    expect(['walk1', 'walk2']).toContain(spriteFrame(body, { hunger: 0, happiness: 10 }));
  });
});
