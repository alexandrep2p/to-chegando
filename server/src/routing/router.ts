import { FALLBACK_SPEED_MPS, encodePolyline, haversine, type LatLng } from '@tc/shared';

export interface RouteResult {
  /** Polyline codificada (precisão 5). */
  geometry: string;
  /** Um trecho por ponto depois do primeiro. */
  legs: { seconds: number; meters: number }[];
  /** Cada ponto de entrada encaixado na rua mais próxima, quando o roteador informa. */
  snapped?: LatLng[];
}

export interface Router {
  route(points: LatLng[]): Promise<RouteResult>;
  /**
   * Melhor ordem de visita saindo de points[0]. Devolve os índices de `points` em ordem,
   * começando por 0. Com `fixedEnd`, o último ponto continua sendo o último.
   */
  optimize(points: LatLng[], fixedEnd: boolean): Promise<number[]>;
}

/** Ruas não são retas: fator médio entre distância em linha reta e pela rua. */
const DETOUR = 1.3;

/** Estimativa em linha reta, usada quando o roteador não responde. */
export function straightRoute(points: LatLng[]): RouteResult {
  const legs = [];
  for (let i = 1; i < points.length; i++) {
    const meters = haversine(points[i - 1], points[i]) * DETOUR;
    legs.push({ meters, seconds: meters / FALLBACK_SPEED_MPS });
  }
  return { geometry: encodePolyline(points), legs };
}

/** Vizinho mais próximo: bom o bastante para poucas paradas. */
export function greedyOrder(points: LatLng[], fixedEnd: boolean): number[] {
  const last = points.length - 1;
  const left = new Set(points.map((_, i) => i).slice(1));
  if (fixedEnd && last > 0) left.delete(last);
  const order = [0];
  let at = 0;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    for (const i of left) {
      const d = haversine(points[at], points[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    left.delete(best);
    order.push(best);
    at = best;
  }
  if (fixedEnd && last > 0) order.push(last);
  return order;
}

/** Roteador sem rede, para testes e simulação. */
export const straightRouter: Router = {
  route: async (points) => straightRoute(points),
  optimize: async (points, fixedEnd) => greedyOrder(points, fixedEnd),
};
