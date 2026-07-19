export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type RequestOpts = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

export async function api<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { body, headers, ...rest } = opts;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    if (!location.pathname.startsWith('/login')) {
      location.href = '/login';
    }
    throw new ApiError(401, 'unauthorized');
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new ApiError(res.status, data.error || res.statusText || 'request failed');
  }
  return data;
}
