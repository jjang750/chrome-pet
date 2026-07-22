// 포즈별 6프레임 시트(RGB, 배경 있음)를 읽어 배경 투명화→프레임 분리→64x104 시트로 합성한다.
// 프레임 순서: idle, walk1, walk2, fall, happy, hungry (왼→오).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FRAME_W = 64;
const FRAME_H = 104;
const FRAMES = ['idle', 'walk1', 'walk2', 'fall', 'happy', 'hungry'];
const BG_MIN = 236; // 이 값 이상(모든 채널)이면 근백색 배경으로 본다
const ALPHA_THRESHOLD = 16;

/** 테두리에서 연결된 근백색 픽셀을 flood-fill 로 투명화한다(캐릭터 내부 흰색은 보존). */
function keyBackground(png) {
  const { width: w, height: h, data } = png;
  const isBg = (i) => data[i] >= BG_MIN && data[i + 1] >= BG_MIN && data[i + 2] >= BG_MIN;
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
    data[p * 4 + 3] = 0; // 투명
    const x = p % w, y = (p / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
}

/** 열별 불투명 픽셀 수로 프레임 구간 [x0,x1] 들을 찾는다(프레임 사이 투명 갭 기준). */
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
  return segs.filter((s) => s.x1 - s.x0 + 1 >= 20); // 너무 좁은 노이즈 구간 제거
}

/** 주어진 x 범위 내 알파 경계 상자. */
function alphaBBox(png, x0, x1) {
  const { width: w, height: h, data } = png;
  let minX = x1, minY = h, maxX = x0, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = x0; x <= x1; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxY < 0) return { x: x0, y: 0, w: x1 - x0 + 1, h };
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
          ar += src.data[i] * a;
          ag += src.data[i + 1] * a;
          ab += src.data[i + 2] * a;
          aa += src.data[i + 3];
          n++;
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

/** 이미 투명 배경인지 판정(투명 픽셀 비율이 높으면 배경 키잉을 건너뛴다). */
function hasTransparentBackground(png) {
  let transparent = 0;
  const total = png.width * png.height;
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] < ALPHA_THRESHOLD) transparent++;
  return transparent / total > 0.2;
}

export async function makeSprite(srcPath, destPath) {
  const src = PNG.sync.read(await readFile(srcPath));
  // 불투명 배경(RGB)일 때만 flood-fill 키잉. 이미 투명하면 알파를 그대로 신뢰(밝은 가장자리 침식 방지).
  if (!hasTransparentBackground(src)) keyBackground(src);
  let segs = findSegments(src);

  // 6개가 안 잡히면 균등 6분할로 폴백.
  if (segs.length !== FRAMES.length) {
    const per = src.width / FRAMES.length;
    segs = FRAMES.map((_, i) => ({ x0: Math.round(i * per), x1: Math.round((i + 1) * per) - 1 }));
  }

  const sheet = new PNG({ width: FRAME_W * FRAMES.length, height: FRAME_H });
  sheet.data.fill(0);

  for (let f = 0; f < FRAMES.length; f++) {
    const seg = segs[f];
    const box = alphaBBox(src, seg.x0, seg.x1);
    const scale = Math.min(FRAME_W / box.w, FRAME_H / box.h);
    const dstW = Math.max(1, Math.round(box.w * scale));
    const dstH = Math.max(1, Math.round(box.h * scale));
    const frame = downsample(src, box, dstW, dstH);
    const offX = f * FRAME_W + Math.floor((FRAME_W - dstW) / 2);
    const offY = FRAME_H - dstH; // 발을 셀 바닥에
    for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) {
        const si = (y * dstW + x) * 4;
        const dxp = offX + x, dyp = offY + y;
        if (dxp < 0 || dyp < 0 || dyp >= FRAME_H) continue;
        const di = (dyp * sheet.width + dxp) * 4;
        sheet.data[di] = frame[si];
        sheet.data[di + 1] = frame[si + 1];
        sheet.data[di + 2] = frame[si + 2];
        sheet.data[di + 3] = frame[si + 3];
      }
    }
  }

  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, PNG.sync.write(sheet));
  return { width: sheet.width, height: sheet.height, segments: segs.length };
}

const SRC = resolve(root, 'assets/frames/sprite_images_v2.png');
const DEST = resolve(root, 'src/assets/pet.png');
const info = await makeSprite(SRC, DEST);
console.log(`sprite ok → src/assets/pet.png (${info.width}x${info.height}, segments ${info.segments})`);
