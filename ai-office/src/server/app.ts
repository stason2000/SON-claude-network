import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { schemaVersion, type Db } from './db.js';
import { AppError } from './errors.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerTaskRoutes } from './routes/tasks.js';
import type { SystemInfo } from '../shared/types.js';

export interface AppOptions {
  db: Db;
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  /** 빌드된 프론트엔드 폴더. 없으면 API만 제공합니다. (개발 중에는 Vite가 화면을 제공) */
  webDir?: string;
  allowedHosts?: string[];
  logger?: boolean;
}

export const APP_NAME = 'AI OFFICE';
export const APP_VERSION = '0.1.0';
export const APP_STAGE = 1;

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostnameOf(hostHeader: string): string {
  // "localhost:4100" -> "localhost", "[::1]:4100" -> "[::1]"
  return hostHeader.startsWith('[') ? hostHeader.slice(0, hostHeader.indexOf(']') + 1) : hostHeader.split(':')[0]!;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const startedAt = new Date();
  // 스키마에 없는 필드는 조용히 지우지 않고 400 으로 거부합니다. (오타·잘못된 호출을 바로 발견하기 위함)
  const app = Fastify({
    logger: opts.logger ?? false,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const extraHosts = new Set((opts.allowedHosts ?? []).map((h) => h.toLowerCase()));

  // 보안 1: Host 헤더 검사 (DNS rebinding 방어). 로컬 호스트명 또는 ALLOWED_HOSTS 만 허용.
  // 보안 2: 쓰기 요청의 Origin 이 같은 호스트가 아니면 거부 (다른 웹사이트에서 보내는 CSRF 방어).
  app.addHook('onRequest', async (req, reply) => {
    const hostHeader = (req.headers.host ?? '').toLowerCase();
    if (!LOCAL_HOSTNAMES.has(hostnameOf(hostHeader)) && !extraHosts.has(hostHeader)) {
      return reply.code(403).send({ error: { code: 'forbidden_host', message: '허용되지 않은 Host 입니다.' } });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        let originHost = '';
        try {
          originHost = new URL(origin).host.toLowerCase();
        } catch {
          /* 잘못된 Origin 은 아래에서 거부 */
        }
        if (originHost !== hostHeader) {
          return reply.code(403).send({ error: { code: 'forbidden_origin', message: '허용되지 않은 Origin 입니다.' } });
        }
      }
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err.validation) {
      return reply.code(400).send({ error: { code: 'validation_error', message: `입력값이 올바르지 않습니다: ${err.message}` } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: 'bad_request', message: err.message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal_error', message: '서버 내부 오류가 발생했습니다.' } });
  });

  app.get('/api/system', async (): Promise<SystemInfo> => ({
    name: APP_NAME,
    version: APP_VERSION,
    stage: APP_STAGE,
    nodeVersion: process.version,
    platform: process.platform,
    startedAt: startedAt.toISOString(),
    uptimeSec: Math.round((Date.now() - startedAt.getTime()) / 1000),
    host: opts.host,
    port: opts.port,
    dataDir: opts.dataDir,
    dbPath: opts.dbPath,
    schemaVersion: schemaVersion(opts.db),
  }));

  registerDashboardRoutes(app, opts.db);
  registerProjectRoutes(app, opts.db);
  registerTaskRoutes(app, opts.db);
  registerSettingsRoutes(app, opts.db);

  const webDir = opts.webDir;
  if (webDir && existsSync(path.join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'not_found', message: '존재하지 않는 API 입니다.' } });
      }
      return reply.sendFile('index.html'); // SPA 라우팅
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.code(404).send({ error: { code: 'not_found', message: '찾을 수 없습니다.' } }),
    );
  }
  return app;
}
