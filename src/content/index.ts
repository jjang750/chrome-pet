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

// spriteFrame 이 반환하는 프레임 키 → 시트 내 인덱스 (pet.png 는 이 순서로 6프레임).
const FRAME_INDEX: Record<string, number> = {
  idle: 0,
  walk1: 1,
  walk2: 2,
  fall: 3,
  happy: 4,
  hungry: 5,
};

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
  loadPet()
    .then((pet) => {
      if (pet) mood = { hunger: pet.hunger, happiness: pet.happiness };
    })
    .catch((err) => console.error('[pet] loadPet failed', err));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.pet) return;
    const pet = changes.pet.newValue as { hunger: number; happiness: number } | undefined;
    if (pet) mood = { hunger: pet.hunger, happiness: pet.happiness };
  });

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

  /** 후보를 새로 훑어 팻 x 에 가장 가까운 유효 요소 하나를 고른다(결정적). */
  function pickTarget(): Element | null {
    let best: Element | null = null;
    let bestDist = Infinity;
    const petCx = body.pos.x + SPRITE_W / 2;
    const nodes = document.querySelectorAll(TARGET_SELECTOR);
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (!isValidRect(node, rect)) continue;
      const cx = (rect.left + rect.right) / 2;
      const dist = Math.abs(cx - petCx);
      if (dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }
    return best;
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

    const env: Env = {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      ground: window.innerHeight - SPRITE_H,
      perch: computePerch(now),
    };

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
