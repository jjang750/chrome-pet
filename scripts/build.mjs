// src 진입점들을 dist 로 번들링하고 정적 파일(manifest, html)을 복사하는 빌드 스크립트
import { build } from 'esbuild';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
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

// src/assets 의 스프라이트 시트를 전부 dist 로 복사한다(캐릭터 선택용 pet.png·pet2.png…).
// 캐릭터를 추가할 땐 src/assets 에 시트를 넣고 core/characters.ts 와 manifest 의
// web_accessible_resources 에 등록하면 된다 — 이 스크립트는 손댈 필요 없다.
// 재생성이 필요하면 `node scripts/make-sprite.mjs` 로 시트를 갱신한다.
const sprites = (await readdir(resolve(root, 'src/assets'))).filter((f) => f.endsWith('.png'));
for (const sprite of sprites) {
  await cp(resolve(root, 'src/assets', sprite), resolve(dist, sprite));
}

console.log('build ok → dist/');
