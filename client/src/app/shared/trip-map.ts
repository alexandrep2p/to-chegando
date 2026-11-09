import { haversine, type LatLng } from '@tc/shared';
import type { TripStore } from '../core/trip.store';
import { fmtEta, initial } from './format';
import type { MapMarker } from './map';

/** Pessoa só ganha um ponto próprio no mapa se estiver longe do pino dela. */
const PERSON_MIN_OFFSET_M = 30;

/**
 * Marcadores da viagem: motorista, paradas numeradas e pessoas fora do pino.
 * `etaLabels` põe o tempo na etiqueta de cada parada (visão do motorista).
 */
export function tripMarkers(store: TripStore, opts: { etaLabels: boolean }): MapMarker[] {
  const v = store.view();
  if (!v) return [];
  const me = v.you.memberId;
  const positions = store.positions();
  const out: MapMarker[] = [];

  let n = 0;
  for (const s of v.stops) {
    const done = s.status === 'arrived';
    const mine = s.memberId === me;
    const eta = done ? null : store.etaOf(s);
    let label = mine ? 'Você' : s.label;
    if (opts.etaLabels && eta !== null) label += ` · ${store.driverStale() ? '~' : ''}${fmtEta(eta)}`;
    out.push({
      id: `stop:${s.id}`,
      kind: s.kind === 'destination' ? 'destination' : 'stop',
      point: s.point,
      text: done ? '' : String(++n),
      label,
      mine,
      done,
    });
  }

  for (const m of v.members) {
    const fix = positions[m.id] ?? m.fix;
    if (!fix) continue;
    const stop = v.stops.find((s) => s.memberId === m.id);
    if (stop && (stop.status === 'arrived' || haversine(stop.point, fix) < PERSON_MIN_OFFSET_M)) {
      continue;
    }
    out.push({
      id: `person:${m.id}`,
      kind: m.id === me ? 'me' : 'person',
      point: fix,
      text: initial(m.name),
    });
  }

  const fix = store.driverFix();
  if (fix) {
    out.push({
      id: 'driver',
      kind: 'driver',
      point: fix,
      heading: fix.heading,
      stale: store.driverStale(),
      label: v.you.role === 'driver' ? undefined : v.driver.name,
    });
  }
  return out;
}

/** Pontos para enquadrar: o motorista e as paradas pendentes. */
export function tripBounds(store: TripStore): LatLng[] {
  const fix = store.driverFix();
  const points: LatLng[] = store.pending().map((s) => s.point);
  if (fix) points.push({ lat: fix.lat, lng: fix.lng });
  return points;
}
