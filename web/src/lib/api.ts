export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Headers added to every request (the test page uses this for device binding). */
let extraHeaders: Record<string, string> = {};
export function setExtraHeaders(h: Record<string, string>) {
  extraHeaders = h;
}
export const getExtraHeaders = () => extraHeaders;

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { ...extraHeaders, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};
