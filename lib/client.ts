/**
 * Tiny typed fetch client for the React UI -> Next API routes.
 * All calls are same-origin (the app and API are served by the same Next server, in the browser
 * or inside the Electron renderer). Throws ApiError on non-2xx so callers can surface messages.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || res.statusText, data?.code);
  }
  return data as T;
}

export const api = {
  get: <T = unknown>(url: string) => fetch(url, { cache: 'no-store' }).then((r) => handle<T>(r)),
  post: <T = unknown>(url: string, body?: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  patch: <T = unknown>(url: string, body?: unknown) =>
    fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  del: <T = unknown>(url: string) => fetch(url, { method: 'DELETE' }).then((r) => handle<T>(r)),
};
