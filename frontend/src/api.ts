import type { ApiError, ApiResponse } from './types';

export class ApiRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

export async function request<T>(path: string, options: RequestInit = {}, userId?: number): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (userId !== undefined) headers.set('X-Demo-User-Id', String(userId));
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('网络连接失败，请检查本地服务后重试');
  }
  let body: ApiResponse<T> | ApiError;
  try { body = await response.json(); }
  catch { throw new Error('服务暂时无法返回数据，请稍后重试'); }
  if (!response.ok || 'error' in body) {
    if ('error' in body) throw new ApiRequestError(body.error.code, body.error.message);
    throw new Error('操作未完成，请稍后重试');
  }
  return body;
}
