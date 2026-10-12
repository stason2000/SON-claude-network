import type { ApiErrorBody } from '../shared/types.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. AI OFFICE 서버가 실행 중인지 확인하세요.');
  }
  if (!res.ok) {
    let message = `요청 실패 (${res.status})`;
    try {
      message = ((await res.json()) as ApiErrorBody).error.message;
    } catch {
      /* 본문이 JSON 이 아니면 기본 메시지 사용 */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
