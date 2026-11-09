import type { LatLng } from './types';

const R = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Distância em metros entre dois pontos. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidPoint(p: unknown): p is LatLng {
  if (!p || typeof p !== 'object') return false;
  const { lat, lng } = p as Record<string, unknown>;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/** Projeta em metros num plano local centrado em `origin` (bom para distâncias curtas). */
function toLocal(p: LatLng, origin: LatLng): { x: number; y: number } {
  return {
    x: rad(p.lng - origin.lng) * R * Math.cos(rad(origin.lat)),
    y: rad(p.lat - origin.lat) * R,
  };
}

/** Menor distância em metros de `p` até a linha `line`. Infinity se a linha for vazia. */
export function distanceToLine(p: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversine(p, line[0]);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = toLocal(line[i], p);
    const b = toLocal(line[i + 1], p);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    const d = Math.hypot(a.x + t * dx, a.y + t * dy);
    if (d < best) best = d;
  }
  return best;
}

export function lineLength(line: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversine(line[i - 1], line[i]);
  return total;
}

/** Ponto a `meters` do início da linha, andando sobre ela. */
export function pointAlong(line: LatLng[], meters: number): LatLng {
  if (line.length === 0) throw new Error('linha vazia');
  let left = Math.max(0, meters);
  for (let i = 1; i < line.length; i++) {
    const seg = haversine(line[i - 1], line[i]);
    if (left <= seg && seg > 0) {
      const t = left / seg;
      return {
        lat: line[i - 1].lat + (line[i].lat - line[i - 1].lat) * t,
        lng: line[i - 1].lng + (line[i].lng - line[i - 1].lng) * t,
      };
    }
    left -= seg;
  }
  return line[line.length - 1];
}

/** Direção em graus (0 = norte, sentido horário) de `a` para `b`. */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Polyline codificada do Google, precisão 5 (o formato padrão do OSRM). */
export function encodePolyline(points: LatLng[]): string {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const enc = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    enc(lat - prevLat);
    enc(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

export function decodePolyline(str: string): LatLng[] {
  const points: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < str.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}
