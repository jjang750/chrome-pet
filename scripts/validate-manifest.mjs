// manifest.json 이 MV3 스키마의 핵심 요건을 만족하는지 검증하는 자체 스크립트
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`manifest invalid: ${msg}`);
  process.exit(1);
}

const raw = await readFile(resolve(root, 'manifest.json'), 'utf8').catch(() => fail('manifest.json 없음'));

let m;
try {
  m = JSON.parse(raw);
} catch {
  fail('JSON 파싱 실패');
}

if (m.manifest_version !== 3) fail('manifest_version 은 3 이어야 함');
if (!m.name) fail('name 필수');
if (!/^\d+\.\d+\.\d+$/.test(m.version ?? '')) fail('version 은 x.y.z 형식이어야 함');
if (!m.background?.service_worker) fail('background.service_worker 필수');

const declared = new Set(m.permissions ?? []);
for (const need of ['storage', 'alarms']) {
  if (!declared.has(need)) fail(`permissions 에 '${need}' 필요`);
}

// 캐릭터 스프라이트 경계면 검사 — core/characters.ts · manifest · src/assets 세 곳이 일치해야 한다.
// 하나라도 빠지면 그 캐릭터를 고른 순간 팻이 조용히 사라진다(런타임 404). 여기서 미리 잡는다.
const charactersSrc = await readFile(resolve(root, 'src/core/characters.ts'), 'utf8').catch(() =>
  fail('src/core/characters.ts 없음'),
);
const sprites = [...charactersSrc.matchAll(/sprite:\s*'([^']+)'/g)].map((mt) => mt[1]);
if (sprites.length === 0) fail('characters.ts 에서 sprite 를 하나도 찾지 못함');

const exposed = new Set((m.web_accessible_resources ?? []).flatMap((r) => r.resources ?? []));
const assets = new Set(await readdir(resolve(root, 'src/assets')));
for (const sprite of sprites) {
  if (!exposed.has(sprite)) fail(`web_accessible_resources 에 '${sprite}' 누락`);
  if (!assets.has(sprite)) fail(`src/assets/${sprite} 파일 없음`);
}

console.log(`manifest ok (캐릭터 스프라이트 ${sprites.length}종 확인)`);
