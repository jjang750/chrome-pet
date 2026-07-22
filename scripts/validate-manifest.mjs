// manifest.json 이 MV3 스키마의 핵심 요건을 만족하는지 검증하는 자체 스크립트
import { readFile } from 'node:fs/promises';
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

console.log('manifest ok');
