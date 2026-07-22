// src 진입점들을 dist 로 번들링하고 정적 파일(manifest, html)을 복사하는 빌드 스크립트
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    background: resolve(root, 'src/background/index.ts'),
    content: resolve(root, 'src/content/index.ts'),
    sidepanel: resolve(root, 'src/sidepanel/index.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'info',
});

await cp(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'));
await cp(resolve(root, 'src/sidepanel/sidepanel.html'), resolve(dist, 'sidepanel.html'));

// 실제 스프라이트 시트(src/assets/pet.png)를 dist 로 복사.
// 재생성이 필요하면 `node scripts/make-sprite.mjs` 로 src/assets/pet.png 를 갱신한다.
await cp(resolve(root, 'src/assets/pet.png'), resolve(dist, 'pet.png'));

console.log('build ok → dist/');
