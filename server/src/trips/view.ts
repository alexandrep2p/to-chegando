import {
  STALE_AFTER_MS,
  encodePolyline,
  type MemberView,
  type StopView,
  type TripView,
} from '@tc/shared';
import type { Member, Trip } from './Trip';

export const isStale = (m: Member, now: number) =>
  m.lastFix !== null && now - m.lastFix.at > STALE_AFTER_MS;

function memberView(m: Member, now: number): MemberView {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    connected: m.connected,
    stale: isStale(m, now),
    fix: m.lastFix,
    pickup: m.pickup,
  };
}

/** O que um membro enxerga da viagem. Nada de sessionHash nem de campos internos. */
export function buildView(trip: Trip, memberId: string, now: number): TripView {
  const you = trip.member(memberId);
  const stops: StopView[] = trip.stops.map((s) => ({
    id: s.id,
    kind: s.kind,
    memberId: s.memberId,
    point: s.point,
    label: s.label,
    address: s.address,
    status: s.status,
    arrivedAt: s.arrivedAt,
    arrivedBy: s.arrivedBy,
    etaSeconds: s.etaSeconds,
    etaMeters: s.etaMeters,
  }));
  return {
    code: trip.code,
    phase: trip.phase,
    you: { memberId: you.id, role: you.role },
    driver: memberView(trip.driver, now),
    members: [...trip.members.values()]
      .filter((m) => m.id !== trip.driverId)
      .map((m) => memberView(m, now)),
    stops,
    route: trip.route && {
      geometry: trip.route.geometry,
      computedAt: trip.route.computedAt,
      approximate: trip.route.approximate,
    },
    trail: encodePolyline(trip.trail),
    serverNow: now,
  };
}
