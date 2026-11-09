import { SEARCH_MAX, type LatLng, type PlaceResult } from '@tc/shared';

export interface Geocoder {
  /** Endereço curto do ponto ("Av. Brasil, 845"), ou null se não achar. */
  reverse(point: LatLng): Promise<string | null>;
  search(query: string, near: LatLng | null): Promise<PlaceResult[]>;
}

export const nullGeocoder: Geocoder = {
  reverse: async () => null,
  search: async () => [],
};

const TIMEOUT_MS = 8000;
/** Política de uso do Nominatim: no máximo 1 requisição por segundo. */
const SPACING_MS = 1100;
const CACHE_MAX = 500;

function shortAddress(a: Record<string, string> | undefined, displayName: string): string {
  const road = a?.['road'] ?? a?.['pedestrian'] ?? a?.['footway'] ?? a?.['path'];
  if (road) return a?.['house_number'] ? `${road}, ${a['house_number']}` : road;
  return displayName.split(',').slice(0, 2).join(',').trim();
}

export function createNominatim(baseUrl: string, userAgent: string): Geocoder {
  const base = baseUrl.replace(/\/+$/, '');
  const cache = new Map<string, unknown>();
  let queue: Promise<unknown> = Promise.resolve();
  let lastAt = 0;

  /** Enfileira as chamadas com o espaçamento exigido e guarda o resultado em cache. */
  function cached<T>(key: string, url: string, map: (body: any) => T): Promise<T> {
    if (cache.has(key)) return Promise.resolve(cache.get(key) as T);
    const run = async () => {
      if (cache.has(key)) return cache.get(key) as T;
      const wait = lastAt + SPACING_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      const res = await fetch(url, {
        headers: { 'User-Agent': userAgent, 'Accept-Language': 'pt-BR' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
      const value = map(await res.json());
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, value);
      return value;
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    async reverse(point) {
      const lat = point.lat.toFixed(5);
      const lng = point.lng.toFixed(5);
      try {
        return await cached(
          `r:${lat},${lng}`,
          `${base}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
          (body) => (body?.display_name ? shortAddress(body.address, body.display_name) : null),
        );
      } catch {
        return null;
      }
    },

    async search(rawQuery, near) {
      const query = rawQuery.trim().slice(0, SEARCH_MAX);
      if (query.length < 3) return [];
      let url = `${base}/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(query)}`;
      let key = `s:${query.toLowerCase()}`;
      if (near) {
        // Viés para a região do motorista (cerca de 50 km), sem excluir o resto.
        const d = 0.5;
        url += `&viewbox=${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`;
        key += `@${near.lat.toFixed(1)},${near.lng.toFixed(1)}`;
      }
      try {
        return await cached(key, url, (body) =>
          (Array.isArray(body) ? body : []).map(
            (r: any): PlaceResult => ({
              label: String(r.display_name).split(',').slice(0, 3).join(',').trim(),
              point: { lat: Number(r.lat), lng: Number(r.lon) },
            }),
          ),
        );
      } catch {
        return [];
      }
    },
  };
}
