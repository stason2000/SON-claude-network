// 개발용 실행기: API 서버(tsx watch)와 Vite 개발 서버를 함께 띄웁니다. 추가 의존성 없음, Windows 호환.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const children = [
  spawn(process.execPath, [tsxCli, 'watch', 'src/server/index.ts'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [viteCli], { cwd: root, stdio: 'inherit' }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
  process.exit(code);
}
for (const c of children) c.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log('\n[ai-office] 화면: http://localhost:5173   API: http://127.0.0.1:' + (process.env.PORT ?? '4100') + '\n');
