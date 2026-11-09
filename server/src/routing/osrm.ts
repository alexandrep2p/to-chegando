import type { LatLng } from '@tc/shared';
import { greedyOrder, type RouteResult, type Router } from './router';

const TIMEOUT_MS = 8000;
/** O servidor público do OSRM recusa rotas com muitos pontos. */
const MAX_POINTS = 100;

const coords = (points: LatLng[]) =>
  points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');

async function getJson(url: string, userAgent: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const body = (await res.json()) as any;
  if (body.code !== 'Ok') throw new Error(`OSRM ${body.code}`);
  return body;
}

export function createOsrm(baseUrl: string, userAgent: string): Router {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    async route(points): Promise<RouteResult> {
      if (points.length > MAX_POINTS) throw new Error('pontos demais para o OSRM');
      const body = await getJson(
        `${base}/route/v1/driving/${coords(points)}?overview=full&geometries=polyline&steps=false`,
        userAgent,
      );
      const route = body.routes[0];
      return {
        geometry: route.geometry,
        legs: route.legs.map((l: any) => ({ seconds: l.duration, meters: l.distance })),
        snapped: Array.isArray(body.waypoints)
          ? body.waypoints.map((w: any) => ({ lat: w.location[1], lng: w.location[0] }))
          : undefined,
      };
    },

    async optimize(points, fixedEnd) {
      if (points.length <= 2) return points.map((_, i) => i);
      if (points.length > MAX_POINTS) return greedyOrder(points, fixedEnd);
      try {
        const body = await getJson(
          `${base}/trip/v1/driving/${coords(points)}?source=first&roundtrip=false` +
            `&destination=${fixedEnd ? 'last' : 'any'}&overview=false`,
          userAgent,
        );
        // waypoints[i].waypoint_index = posição do ponto i na ordem otimizada.
        const order: number[] = [];
        body.waypoints.forEach((w: any, i: number) => {
          order[w.waypoint_index] = i;
        });
        if (order.length !== points.length || order[0] !== 0 || order.includes(undefined as never)) {
          return greedyOrder(points, fixedEnd);
        }
        return order;
      } catch {
        return greedyOrder(points, fixedEnd);
      }
    },
  };
}
