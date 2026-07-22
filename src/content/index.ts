// window.Notification 을 프록시로 감싸 알림 발생을 service worker 로 전달한다
const OriginalNotification = window.Notification;

class ProxiedNotification extends OriginalNotification {
  constructor(title: string, options?: NotificationOptions) {
    super(title, options);
    void chrome.runtime.sendMessage({ type: 'notification', title }).catch(() => {
      // SW 유휴 상태면 실패할 수 있다. 조용히 무시하되 삼키지 않도록 로깅.
      console.warn('[pet] notification relay failed');
    });
  }
}

window.Notification = ProxiedNotification as unknown as typeof Notification;

// ── 팻 오버레이 + requestAnimationFrame 렌더 루프 ─────────────────────────────
// core 의 순수 물리 함수를 실제 DOM/뷰포트에 배선한다. 로직은 core, 여기선 배선만.
import { step, spriteFrame, SPRITE_W, SPRITE_H } from '../core/petBehavior';
import type { PetBody, Env, Mood } from '../core/petBehavior';
import { createPet } from '../core/petState';
import { loadPet } from '../chrome/storage';

// spriteFrame 이 반환하는 프레임 키 → 시트 내 인덱스 (pet.png 는 이 순서로 9프레임).
const FRAME_INDEX: Record<string, number> = {
  idle: 0,
  walk1: 1,
  walk2: 2,
  fall: 3,
  happy: 4,
  hungry: 5,
  want_play: 6,
  sleep: 7,
  eat: 8,
};

// 먹이 주기 감지 시 eating 애니메이션 지속 시간 (ms).
const EAT_MS = 2000;

// perched(요소 위) 최대 체류 시간 (ms). 넘으면 타깃을 놓아 내려오게 한다.
const PERCH_MS = 6000;

// 마우스가 이 시간 이상 안 움직이면 팻이 커서로 올라가 논다(playing).
const IDLE_MOUSE_MS = 30000;

// playing 중 커서를 향한 이동 보간 계수(프레임당). 클수록 빨리 붙는다.
const PLAY_LERP = 0.15;

function startPetOverlay(): void {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    `width:${SPRITE_W}px`,
    `height:${SPRITE_H}px`,
    'z-index:2147483647', // 최대 z-index
    'pointer-events:auto', // 드래그 수신용. 팻 영역(64×104px)에서만 클릭을 가져간다(의도된 트레이드오프).
    'cursor:grab', // 잡을 수 있음을 표시. 잡는 중엔 grabbing 으로 전환.
    'image-rendering:pixelated',
    'background-repeat:no-repeat',
    `background-image:url(${chrome.runtime.getURL('pet.png')})`,
  ].join(';');
  document.body.appendChild(el);

  // mood 는 storage 단일 진실. 초기값은 기본 팻, 로드/변경 시 갱신.
  let mood: Mood = createPet(Date.now());
  // 직전 hunger 값. 먹이 주기(hunger 감소) 감지에 쓴다. 초기엔 현재값으로 맞춰 첫 변경 오탐 방지.
  let prevHunger = mood.hunger;
  // eating 종료 시각(performance.now 기준). 0 이면 먹는 중 아님.
  let eatingUntil = 0;

  loadPet()
    .then((pet) => {
      if (pet) {
        mood = { hunger: pet.hunger, happiness: pet.happiness };
        prevHunger = pet.hunger;
      }
    })
    .catch((err) => console.error('[pet] loadPet failed', err));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.pet) return;
    const pet = changes.pet.newValue as { hunger: number; happiness: number } | undefined;
    if (!pet) return;
    // hunger 가 감소했으면(사이드패널 먹이 주기) 먹는 중으로 전환.
    // 단, 잡혀있거나(held)·공중(falling)일 땐 트리거하지 않는다. 지면 상태(walking/idle/sleeping)만.
    if (
      pet.hunger < prevHunger &&
      body.mode !== 'held' &&
      body.mode !== 'falling' &&
      !dragging
    ) {
      body.mode = 'eating';
      eatingUntil = performance.now() + EAT_MS;
    }
    prevHunger = pet.hunger;
    mood = { hunger: pet.hunger, happiness: pet.happiness };
  });

  // ── 마우스 추적(playing 트리거) ─────────────────────────────────────
  // 마지막 mousemove 시각(performance.now 기준)·커서 좌표. 30초 정지 감지에 쓴다.
  let lastMouseMoveAt = performance.now();
  let cursor = { x: 0, y: 0 };
  let haveCursor = false; // 최소 1회 mousemove 전엔 커서 위치를 모른다.

  // 초기 body: 화면 상단에서 낙하 시작.
  let body: PetBody = {
    pos: { x: Math.max(0, (window.innerWidth - SPRITE_W) / 2), y: 0 },
    vel: { x: 0, y: 0 },
    mode: 'falling',
    facing: 1,
    clock: 0,
  };

  // ── 요소 타깃팅(perch) ──────────────────────────────────────────────
  // querySelectorAll 은 비싸므로 재타깃 시점에만 실행. 매 프레임은 target.rect 만 읽는다.
  const TARGET_SELECTOR = 'button, a, img, input, h1, h2';
  const MIN_SIZE = 40; // px. 너무 작은 요소 제외.
  const MAX_SIZE = 400; // px. 너무 큰 요소(레이아웃 덩어리) 제외.
  const RETARGET_INTERVAL = 4000; // ms. 타깃 없을 때 재탐색 쿨다운.

  let target: Element | null = null;
  let nextRetargetAt = 0; // performance.now() 기준.
  // 방금 perch 를 떠난 요소. 다음 재타깃에서 후보가 여럿이면 이 요소는 제외한다(다른 요소로 이동 유도).
  let lastLeftEl: Element | null = null;
  // perched 진입 시각(performance.now 기준). 0 이면 perched 아님. PERCH_MS 초과 시 타깃 release.
  let perchedSince = 0;

  /** rect 가 perch 후보로 유효한가: 화면 안 + 크기 적당. el 이 우리 오버레이면 제외. */
  function isValidRect(node: Element, rect: DOMRect): boolean {
    if (node === el) return false; // 오버레이 자신 제외.
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) return false;
    if (rect.width > MAX_SIZE || rect.height > MAX_SIZE) return false;
    // 뷰포트 안(상단이 화면 내, 좌우가 화면 내)에 실제로 보이는지.
    if (rect.top < 0 || rect.top > window.innerHeight - SPRITE_H) return false;
    if (rect.left < 0 || rect.right > window.innerWidth) return false;
    return true;
  }

  /**
   * 후보를 새로 훑어 팻 x 에 가장 가까운 유효 요소 하나를 고른다(결정적).
   * 방금 떠난 요소(lastLeftEl)는 다른 유효 후보가 있으면 제외한다(오브젝트→다른 오브젝트 이동).
   * 후보가 lastLeftEl 하나뿐이면 그대로 허용한다.
   */
  function pickTarget(): Element | null {
    let best: Element | null = null;
    let bestDist = Infinity;
    let fallback: Element | null = null; // lastLeftEl 만 남았을 때의 예비.
    let fallbackDist = Infinity;
    const petCx = body.pos.x + SPRITE_W / 2;
    const nodes = document.querySelectorAll(TARGET_SELECTOR);
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (!isValidRect(node, rect)) continue;
      const cx = (rect.left + rect.right) / 2;
      const dist = Math.abs(cx - petCx);
      if (node === lastLeftEl) {
        // 방금 떠난 요소는 예비로만 기록.
        if (dist < fallbackDist) {
          fallbackDist = dist;
          fallback = node;
        }
        continue;
      }
      if (dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }
    // 다른 후보가 없으면 방금 떠난 요소라도 허용.
    return best ?? fallback;
  }

  /** 매 프레임 호출. 현재 타깃 rect 로 perch 를 계산하거나 null 을 반환한다. */
  function computePerch(now: number): { top: number; left: number; right: number } | null {
    if (target) {
      // 이미 제거·비표시면 즉시 해제 → 팻 낙하.
      if (!target.isConnected) {
        target = null;
      } else {
        const rect = target.getBoundingClientRect();
        if (isValidRect(target, rect)) {
          return { top: rect.top, left: rect.left, right: rect.right };
        }
        // 크기 0·화면 밖(스크롤 이탈 등) → 타깃 해제, 낙하.
        target = null;
      }
    }
    // 타깃 없음: 쿨다운마다 재탐색.
    if (now >= nextRetargetAt) {
      nextRetargetAt = now + RETARGET_INTERVAL;
      target = pickTarget();
      if (target) {
        const rect = target.getBoundingClientRect();
        return { top: rect.top, left: rect.left, right: rect.right };
      }
    }
    return null;
  }

  let rafId = 0;
  let last = 0;
  let running = false;

  function frame(now: number): void {
    // dt 실측(ms). 첫 프레임·긴 정지 후엔 스텝이 튀지 않게 상한.
    const dtMs = last === 0 ? 16 : Math.min(now - last, 100);
    last = now;

    // eating 만료 → 물리 재개(falling). 위치는 그대로, 속도만 0 에서 낙하 시작.
    if (body.mode === 'eating' && now >= eatingUntil) {
      body.mode = 'falling';
      body.vel = { x: 0, y: 0 };
      eatingUntil = 0;
    }

    // 마우스가 IDLE_MOUSE_MS 이상 정지 → playing 진입.
    // 드래그·held·eating·falling(공중) 중에는 진입하지 않는다. 커서 위치를 알아야 이동 가능.
    if (
      haveCursor &&
      !dragging &&
      body.mode !== 'held' &&
      body.mode !== 'eating' &&
      body.mode !== 'playing' &&
      body.mode !== 'falling' &&
      now - lastMouseMoveAt >= IDLE_MOUSE_MS
    ) {
      body.mode = 'playing';
      body.vel = { x: 0, y: 0 };
    }

    // perched 체류 타이머: 요소 위에 PERCH_MS 이상 있으면 타깃을 놓아 내려오게 한다.
    // held/eating/falling 등에는 간섭하지 않도록 mode==='perched' 일 때만 동작.
    if (body.mode === 'perched') {
      if (perchedSince === 0) {
        perchedSince = now; // perched 진입 시점 기록.
      } else if (now - perchedSince >= PERCH_MS && target) {
        // 체류 한도 초과 → 현재 요소를 놓는다. computePerch 가 null 을 반환해 core 가 내려오게 함.
        lastLeftEl = target; // 다음 재타깃에서 제외하기 위해 기억.
        target = null;
        perchedSince = 0;
        nextRetargetAt = now + RETARGET_INTERVAL; // 내려와 잠깐 배회 후 다음 요소로.
      }
    } else {
      perchedSince = 0; // perched 가 아니면 타이머 리셋(다음 perch 를 새로 계측).
    }

    const env: Env = {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      ground: window.innerHeight - SPRITE_H,
      perch: computePerch(now),
    };

    // playing: 커서 위치로 부드럽게 이동. step 은 playing 에서 no-op 이라 이 pos 가 유지된다.
    if (body.mode === 'playing' && haveCursor) {
      const tx = clamp(cursor.x - SPRITE_W / 2, 0, window.innerWidth - SPRITE_W);
      const ty = clamp(cursor.y - SPRITE_H / 2, 0, window.innerHeight - SPRITE_H);
      body.pos = {
        x: body.pos.x + (tx - body.pos.x) * PLAY_LERP,
        y: body.pos.y + (ty - body.pos.y) * PLAY_LERP,
      };
      body.facing = tx >= body.pos.x ? 1 : -1; // 목표 방향으로 바라보기.
    }

    try {
      body = step(body, env, mood, dtMs);
      const idx = FRAME_INDEX[spriteFrame(body, mood)] ?? 0;
      el.style.transform = `translate(${body.pos.x}px, ${body.pos.y}px) scaleX(${body.facing})`;
      el.style.backgroundPositionX = `${-idx * SPRITE_W}px`;
    } catch (err) {
      console.error('[pet] render step failed', err);
    }

    rafId = requestAnimationFrame(frame);
  }

  function start(): void {
    if (running) return;
    running = true;
    last = 0; // dt 재기준 → 복귀 시 점프 방지
    rafId = requestAnimationFrame(frame);
  }

  function stop(): void {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  // ── 마우스 추적 리스너 ──────────────────────────────────────────────
  // 커서 위치·마지막 이동 시각 갱신. playing 중이었으면 해제해 떨어뜨린다.
  window.addEventListener('mousemove', (e: MouseEvent) => {
    lastMouseMoveAt = performance.now();
    cursor = { x: e.clientX, y: e.clientY };
    haveCursor = true;
    if (body.mode === 'playing') {
      body.mode = 'falling'; // 다음 step 에서 중력으로 지면 복귀.
      body.vel = { x: 0, y: 0 };
    }
  });

  // ── 포인터 드래그(집기/이동/놓기) ──────────────────────────────────────
  // held 동안 step 은 identity → pointermove 가 세팅한 pos 가 그대로 유지된다.
  // body 는 rAF 와 공유하는 클로저 참조. 놓으면 falling 으로 물리 재개.
  const clamp = (v: number, lo: number, hi: number): number =>
    v < lo ? lo : v > hi ? hi : v;

  let dragging = false;
  let offset = { x: 0, y: 0 }; // 커서와 팻 좌상단의 차. 잡은 지점 유지용.

  el.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    dragging = true;
    // 잡기 우선: 먹는 중이었어도 즉시 취소하고 held 로.
    eatingUntil = 0;
    offset = { x: e.clientX - body.pos.x, y: e.clientY - body.pos.y };
    body.mode = 'held';
    try {
      el.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn('[pet] setPointerCapture failed', err);
    }
    el.style.cursor = 'grabbing';
  });

  el.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    body.pos = {
      x: clamp(e.clientX - offset.x, 0, window.innerWidth - SPRITE_W),
      y: clamp(e.clientY - offset.y, 0, window.innerHeight - SPRITE_H),
    };
    body.mode = 'held'; // held 유지(rAF 의 step 이 identity 라 pos 보존).
  });

  function endDrag(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    body.mode = 'falling';
    body.vel = { x: 0, y: 0 };
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      // 이미 해제됐거나 캡처가 없으면 무시.
    }
    el.style.cursor = 'grab';
  }

  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  start();
}

// content 는 run_at:document_start 라 body 가 아직 없을 수 있다 → DOM 준비 후 붙인다.
function initPetOverlay(): void {
  if (document.body) {
    startPetOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', () => startPetOverlay(), { once: true });
  }
}

initPetOverlay();
