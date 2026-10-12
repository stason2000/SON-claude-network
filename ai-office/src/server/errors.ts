export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what}을(를) 찾을 수 없습니다.`);
export const badRequest = (message: string) => new AppError(400, 'bad_request', message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
