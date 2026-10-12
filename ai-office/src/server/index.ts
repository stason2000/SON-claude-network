import { existsSync } from 'node:fs';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

// .env 가 있으면 읽습니다. (추가 라이브러리 없이 Node 내장 기능 사용)
if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const db = openDb(config.dbPath);
const app = await buildApp({ db, ...config, logger: true });

// 안전한 종료: 진행 중인 요청을 마치고 DB를 닫습니다.
let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} 수신, 종료합니다.`);
  await app.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    app.log.warn('HOST 가 로컬 전용이 아닙니다. 현재 버전에는 로그인 기능이 없으므로 외부 네트워크에 노출하지 마세요.');
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
