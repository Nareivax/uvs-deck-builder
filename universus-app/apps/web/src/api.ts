import type { CardDetail, CardSearchResponse, MetaResponse } from '@universus/shared';

// '/api' is proxied to the API server in development (see vite.config.ts).
const BASE: string = import.meta.env.VITE_API_URL ?? '/api';

async function get<T>(path: string, params?: URLSearchParams): Promise<T> {
  const query = params && params.size > 0 ? `?${params.toString()}` : '';
  const res = await fetch(`${BASE}${path}${query}`);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  meta: () => get<MetaResponse>('/meta'),
  searchCards: (params: URLSearchParams) => get<CardSearchResponse>('/cards', params),
  card: (id: number) => get<CardDetail>(`/cards/${id}`),
};
