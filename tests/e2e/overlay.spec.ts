// 팻 오버레이 E2E — content 오버레이 div 존재·pointer-events·크기, pet.png 리소스 로드,
// 낙하 후 바닥 근처 수렴, hungry 프레임 전환, 콘솔/전역 에러 0건 확인
import { test, expect, type ConsoleMessage } from '@playwright/test';
import { launchWithExtension } from './harness';

// core/petBehavior 의 SPRITE_W/H 와 일치시킨다. 치수 변경 시 이 두 상수만 고치면 된다.
// hungry 프레임 인덱스는 content 의 FRAME_INDEX.hungry = 5 → background-position-x = -5*SPRITE_W.
const SPRITE_W = 64;
const SPRITE_H = 104;
const HUNGRY_FRAME_INDEX = 5;
const HUNGRY_BG_POS_X = `${-HUNGRY_FRAME_INDEX * SPRITE_W}px`;

// core/petBehavior 의 WALK_MS/IDLE_MS 미러링. 지면에서 한 주기 = WALK_MS 걷기 + IDLE_MS 멈춤.
// hungry(멈춤 표정)는 idle 구간(멈춤)에서만 나온다. 이 값이 어긋나면 폴링 timeout 산정이 틀려
// spec 이 flaky 해지므로 core 값과 동일하게 유지한다(대조 역할).
const WALK_MS = 2500;
const IDLE_MS = 1200;
const CYCLE_MS = WALK_MS + IDLE_MS;

// 오버레이 div 를 특정하는 선택자. content 는 body 에 pet.png 를 background-image 로 쓰는
// 단 하나의 팻 div 를 붙인다. style 속성 문자열 정규화 편차를 피하려고 pet.png 참조로 식별한다.
const OVERLAY_SELECTOR = 'div[style*="pet.png"]';

test('오버레이 div 가 붙고 바닥으로 낙하 수렴하며 hungry 프레임으로 전환되고 에러가 없다', async () => {
  const context = await launchWithExtension();
  try {
    // service worker 기동 대기 후 확장 ID 추출
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();
    const extId = new URL(sw.url()).host;

    // onInstalled 초기화(pet 기본값 저장)가 착지할 때까지 먼저 기다린다.
    // (feed.spec 의 "pet 키 존재 폴링" 레이스 방지 패턴 그대로 적용)
    await expect
      .poll(async () => sw.evaluate(async () => (await chrome.storage.local.get('pet')).pet != null), {
        timeout: 5000,
      })
      .toBe(true);

    // __errors 를 명시적으로 비워 이전 상태 오염을 제거한다.
    await sw.evaluate(async () => {
      await chrome.storage.local.set({ __errors: [] });
    });

    // content script 는 <all_urls> 에서 document_start 로 주입된다.
    // 확장 페이지에는 주입되지 않으므로, 일반 http(s) 가 아닌 about:blank 를 쓰되
    // body 가 필요하므로 data URL 로 최소 문서를 로드한다.
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.goto('data:text/html,<html><body><h1>overlay test</h1></body></html>');

    // ── ① 오버레이 div 존재 + pointer-events:none + SPRITE_W x SPRITE_H ───────────
    const overlay = page.locator(OVERLAY_SELECTOR);
    await expect(overlay).toHaveCount(1, { timeout: 5000 });

    const box = await overlay.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        pointerEvents: cs.pointerEvents,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        position: cs.position,
        zIndex: cs.zIndex,
      };
    });
    expect(box.pointerEvents).toBe('none');
    expect(box.position).toBe('fixed');
    expect(box.width).toBe(SPRITE_W);
    expect(box.height).toBe(SPRITE_H);

    // ── ② web_accessible_resources: pet.png 가 실제 로드되는가 ────────────────────
    // 페이지 컨텍스트에서 chrome.runtime.getURL 은 못 쓰므로, 오버레이가 실제로 참조하는
    // background-image URL 을 읽어 그 URL 을 fetch 로 검증한다(200 + image/png).
    const petUrl = await overlay.evaluate((el) => {
      const bg = getComputedStyle(el).backgroundImage; // url("chrome-extension://.../pet.png")
      const m = /url\("?(.*?)"?\)/.exec(bg);
      return m ? m[1] : '';
    });
    expect(petUrl).toContain('pet.png');
    expect(petUrl).toContain(extId);

    const res = await page.evaluate(async (url) => {
      const r = await fetch(url);
      const blob = await r.blob();
      return { ok: r.ok, status: r.status, type: blob.type, size: blob.size };
    }, petUrl);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.type).toContain('png');
    expect(res.size).toBeGreaterThan(0);

    // ── ③ 낙하 착지: transform 의 y 가 바닥(innerHeight-SPRITE_H) 근처로 수렴 ──────
    // 애니메이션 프레임 변동이 있으므로 정확값이 아니라 tolerance 로 판정한다.
    // 초기 body 는 상단(y=0)에서 시작 → 중력으로 바닥까지 낙하 후 walking 으로 지면에 붙는다.
    const groundY = await page.evaluate((h) => window.innerHeight - h, SPRITE_H);

    // transform matrix 에서 translateY 를 읽는 헬퍼를 poll 로 반복 평가한다.
    await expect
      .poll(
        async () =>
          overlay.evaluate((el) => {
            const t = getComputedStyle(el).transform; // matrix(a,b,c,d,tx,ty)
            if (t === 'none') return 0;
            const m = /matrix\(([^)]+)\)/.exec(t);
            if (!m) return 0;
            const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
            return parts[5]; // ty
          }),
        { timeout: 8000, intervals: [100, 200, 300, 500] },
      )
      // 바닥에서 3px 이내로 수렴하면 착지로 본다(프레임 타이밍 허용).
      .toBeGreaterThan(groundY - 3);

    const finalY = await overlay.evaluate((el) => {
      const t = getComputedStyle(el).transform;
      const m = /matrix\(([^)]+)\)/.exec(t);
      return m ? parseFloat(m[1].split(',')[5].trim()) : 0;
    });
    expect(finalY).toBeGreaterThan(groundY - 3);
    expect(finalY).toBeLessThanOrEqual(groundY + 1);

    // ── ④ hunger 70+ 주입 → 결국 hungry 프레임(background-position-x = -320px) ─────
    // storage 변경은 content 의 onChanged 리스너가 받아 mood 를 갱신한다. 다만 hungry(멈춤 표정)는
    // spriteFrame 우선순위상 falling→walking→(멈춤일 때만)mood 이므로, 지면 걷기 주기의 idle 구간
    // (phase>=WALK_MS)에서만 나타난다. 착지 직후엔 WALK_MS 동안 walk 프레임이라 즉시 단정하면 실패한다.
    // 따라서 "결국 hungry 가 나타난다"를 폴링으로 확인한다. 한 주기 CYCLE_MS(3700ms) 안에 idle 창이
    // 반드시 오므로 timeout 을 한 주기보다 넉넉히(>2*CYCLE_MS) 두고, 촘촘히 폴링해 idle 순간을 잡는다.
    await sw.evaluate(async () => {
      await chrome.storage.local.set({
        pet: { hunger: 80, happiness: 50, lastUpdated: Date.now() },
      });
    });

    await expect
      .poll(
        async () => overlay.evaluate((el) => getComputedStyle(el).backgroundPositionX),
        { timeout: CYCLE_MS * 2 + 2000, intervals: [100, 100, 200, 200, 300] },
      )
      .toBe(HUNGRY_BG_POS_X);

    // ── ⑤ 콘솔 에러 0건 + 전역 __errors 비어있음 ───────────────────────────────
    expect(consoleErrors).toEqual([]);
    const errors = await sw.evaluate(async () => (await chrome.storage.local.get('__errors')).__errors);
    expect(errors ?? []).toEqual([]);
  } finally {
    await context.close();
  }
});
