import path from 'node:path';

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  webDir: string;
  allowedHosts: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 4100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 값이 올바르지 않습니다: ${env.PORT}`);
  }
  const dataDir = path.resolve(env.DATA_DIR || './data');
  return {
    host: env.HOST || '127.0.0.1',
    port,
    dataDir,
    dbPath: path.join(dataDir, 'ai-office.db'),
    webDir: path.resolve('dist/web'),
    allowedHosts: (env.ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  };
}
