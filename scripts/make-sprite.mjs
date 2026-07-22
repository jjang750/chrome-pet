// 가로 한 줄 N프레임 시트를 읽어 배경 투명화→프레임 분리→64x104 시트로 합성한다.
// 각 프레임은 "주 캐릭터(가장 큰 덩어리)" 기준으로 크기·정렬해, 장식(반짝이·모션선)이 있어도
// 프레임 간 캐릭터 크기가 일정하게 유지된다. 장식은 잘리지 않는 한 함께 렌더된다.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FRAME_W = 64;
const FRAME_H = 104;
const TARGET_W = 58; // 주 캐릭터가 셀에서 차지할 최대 폭
const TARGET_H = 100; // 주 캐릭터가 셀에서 차지할 최대 높이
const FRAMES = ['idle', 'walk1', 'walk2', 'fall', 'happy', 'hungry', 'want_play', 'sleep', 'eat'];
const BG_MIN = 210;
const ALPHA_THRESHOLD = 16;

function hasTransparentBackground(png) {
  let transparent = 0;
  const total = png.width * png.height;
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] < ALPHA_THRESHOLD) transparent++;
  return transparent / total > 0.2;
}

/** 불투명 RGB 배경일 때만: 테두리에서 연결된 근백색을 flood-fill 로 투명화. */
function keyBackground(png) {
  const { width: w, height: h, data } = png;
  // 밝고 무채색이면 배경(흰 배경 + 체커보드의 흰/회 두 색 모두 포함). 채도 있는 캐릭터는 제외.
  const isBg = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mn >= BG_MIN && mx - mn <= 20;
  };
  const visited = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (visited[p]) return;
    visited[p] = 1;
    if (isBg(p * 4)) stack.push(p);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    data[p * 4 + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
}

/** 열별 불투명 픽셀로 프레임 구간 [x0,x1] 을 찾는다. */
function findSegments(png) {
  const { width: w, height: h, data } = png;
  const colHas = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < h; y++) if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) count++;
    colHas[x] = count > 4 ? 1 : 0;
  }
  const segs = [];
  let start = -1;
  for (let x = 0; x < w; x++) {
    if (colHas[x] && start < 0) start = x;
    else if (!colHas[x] && start >= 0) { segs.push({ x0: start, x1: x - 1 }); start = -1; }
  }
  if (start >= 0) segs.push({ x0: start, x1: w - 1 });
  return segs.filter((s) => s.x1 - s.x0 + 1 >= 20);
}

/** 세그먼트 [x0,x1] 내 불투명 연결요소들의 경계상자를 반환(4-연결, 픽셀수 포함). */
function components(png, x0, x1) {
  const { width: w, height: h, data } = png;
  const segW = x1 - x0 + 1;
  const visited = new Uint8Array(segW * h);
  const comps = [];
  const stack = [];
  for (let y = 0; y < h; y++) {
    for (let x = x0; x <= x1; x++) {
      const lp = (x - x0) + y * segW;
      if (visited[lp]) continue;
      if (data[(y * w + x) * 4 + 3] <= ALPHA_THRESHOLD) { visited[lp] = 1; continue; }
      let minX = x, maxX = x, minY = y, maxY = y, count = 0;
      stack.length = 0;
      stack.push(x, y);
      visited[lp] = 1;
      while (stack.length) {
        const cy = stack.pop(), cx = stack.pop();
        count++;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        const nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (const [nx, ny] of nb) {
          if (nx < x0 || nx > x1 || ny < 0 || ny >= h) continue;
          const nlp = (nx - x0) + ny * segW;
          if (visited[nlp]) continue;
          visited[nlp] = 1;
          if (data[(ny * w + nx) * 4 + 3] > ALPHA_THRESHOLD) stack.push(nx, ny);
        }
      }
      comps.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count });
    }
  }
  return comps;
}

function alphaBBoxOfSeg(png, x0, x1) {
  const { width: w, height: h, data } = png;
  let minX = x1, minY = h, maxX = x0, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = x0; x <= x1; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** src 의 box 영역을 dstW x dstH 로 면적 평균 다운샘플(프리멀티플라이드 알파). */
function downsample(src, box, dstW, dstH) {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = box.x + Math.floor((dx / dstW) * box.w);
      let sx1 = box.x + Math.floor(((dx + 1) / dstW) * box.w);
      if (sx1 <= sx0) sx1 = sx0 + 1;
      const sy0 = box.y + Math.floor((dy / dstH) * box.h);
      let sy1 = box.y + Math.floor(((dy + 1) / dstH) * box.h);
      if (sy1 <= sy0) sy1 = sy0 + 1;
      let ar = 0, ag = 0, ab = 0, aa = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * src.width + sx) * 4;
          const a = src.data[i + 3] / 255;
          ar += src.data[i] * a; ag += src.data[i + 1] * a; ab += src.data[i + 2] * a;
          aa += src.data[i + 3]; n++;
        }
      }
      const o = (dy * dstW + dx) * 4;
      const aNorm = aa / 255;
      out[o] = aNorm > 0 ? ar / aNorm : 0;
      out[o + 1] = aNorm > 0 ? ag / aNorm : 0;
      out[o + 2] = aNorm > 0 ? ab / aNorm : 0;
      out[o + 3] = n > 0 ? aa / n : 0;
    }
  }
  return out;
}

export async function makeSprite(srcPath, destPath) {
  const src = PNG.sync.read(await readFile(srcPath));
  if (!hasTransparentBackground(src)) keyBackground(src);

  let segs = findSegments(src);
  if (segs.length !== FRAMES.length) {
    const per = src.width / FRAMES.length;
    segs = FRAMES.map((_, i) => ({ x0: Math.round(i * per), x1: Math.round((i + 1) * per) - 1 }));
  }

  // 각 프레임의 주 캐릭터(최대 연결요소) 상자 + 전체 상자 산정.
  const frames = segs.map((seg) => {
    const comps = components(src, seg.x0, seg.x1);
    const main = comps.reduce((a, b) => (b.count > a.count ? b : a), { count: 0, x: seg.x0, y: 0, w: 1, h: 1 });
    const full = alphaBBoxOfSeg(src, seg.x0, seg.x1);
    return { main, full };
  });

  const sheet = new PNG({ width: FRAME_W * FRAMES.length, height: FRAME_H });
  sheet.data.fill(0);

  for (let f = 0; f < FRAMES.length; f++) {
    const { main, full } = frames[f];
    // 주 캐릭터 기준으로 크기를 맞추되(프레임 간 캐릭터 크기 일정),
    // 장식 포함 전체(full)가 셀을 넘지 않도록 상한을 둔다 → 옆/위 잘림 방지.
    const scale = Math.min(
      TARGET_W / main.w,
      TARGET_H / main.h,
      (FRAME_W - 2) / full.w,
      (FRAME_H - 2) / full.h,
    );
    const fw = Math.max(1, Math.round(full.w * scale));
    const fh = Math.max(1, Math.round(full.h * scale));
    const scaled = downsample(src, full, fw, fh);

    // 전체 내용 기준 가로 중앙 + 바닥 정렬(장식이 한쪽에 몰려도 셀 안에 들어온다).
    const left = Math.round((FRAME_W - fw) / 2);
    const top = FRAME_H - fh;

    const baseX = f * FRAME_W;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const dxp = baseX + left + x;
        const dyp = top + y;
        if (dxp < baseX || dxp >= baseX + FRAME_W || dyp < 0 || dyp >= FRAME_H) continue; // 셀 밖 클립
        const si = (y * fw + x) * 4;
        if (scaled[si + 3] <= 0) continue;
        const di = (dyp * sheet.width + dxp) * 4;
        sheet.data[di] = scaled[si];
        sheet.data[di + 1] = scaled[si + 1];
        sheet.data[di + 2] = scaled[si + 2];
        sheet.data[di + 3] = scaled[si + 3];
      }
    }
  }

  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, PNG.sync.write(sheet));
  return { width: sheet.width, height: sheet.height, frames: FRAMES.length };
}

const SRC = resolve(root, 'assets/frames/sprite_images_v4.png');
const DEST = resolve(root, 'src/assets/pet.png');
const info = await makeSprite(SRC, DEST);
console.log(`sprite ok → src/assets/pet.png (${info.width}x${info.height}, frames ${info.frames})`);
