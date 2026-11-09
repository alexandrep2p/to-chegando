import { createHash, randomBytes } from 'node:crypto';
import {
  APPROACH_RADIUS_M,
  ARRIVE_RADIUS_M,
  DEPART_RADIUS_M,
  FOLLOW_STEP_M,
  GOOD_ACCURACY_M,
  LABEL_MAX,
  NAME_MAX,
  POS_MIN_INTERVAL_MS,
  TRAIL_MAX_POINTS,
  TRAIL_MIN_STEP_M,
  haversine,
  isValidPoint,
  type ErrorCode,
  type Fix,
  type FixInput,
  type LatLng,
  type Phase,
  type Pickup,
  type PickupMode,
  type Role,
  type StopView,
  type TripSnapshot,
} from '@tc/shared';

export class TripError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

export const hashSession = (sessionId: string) =>
  createHash('sha256').update(sessionId).digest('hex');

const newId = () => randomBytes(6).toString('base64url');
const newSessionId = () => randomBytes(24).toString('base64url');

export interface Member {
  id: string;
  /** SHA-256 do sessionId. O servidor não guarda o sessionId em si. */
  sessionHash: string;
  name: string;
  role: Role;
  connected: boolean;
  lastFix: Fix | null;
  pickup: Pickup | null;
  /** Último estado de "sem sinal" enviado aos clientes. */
  staleSent: boolean;
}

export interface Stop extends StopView {
  /** O motorista já esteve a menos de APPROACH_RADIUS_M desta parada. */
  approached: boolean;
  /**
   * Ponto da rua mais próximo do pino, quando o pino fica longe da rua (dentro de um
   * parque, de um condomínio). Chegar ali também conta: de carro não dá para ir além.
   */
  access: LatLng | null;
}

export interface Route {
  geometry: string;
  line: LatLng[];
  computedAt: number;
  from: LatLng;
  approximate: boolean;
  /** Identifica o conjunto de paradas para o qual a rota foi calculada. */
  key: string;
}

export interface PositionResult {
  /** null quando a posição foi descartada. */
  fix: Fix | null;
  arrived: Stop | null;
  stopsChanged: boolean;
}

export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') throw new TripError('INVALID_NAME');
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > NAME_MAX) throw new TripError('INVALID_NAME');
  return name;
}

export class Trip {
  phase: Phase = 'lobby';
  readonly members = new Map<string, Member>();
  stops: Stop[] = [];
  route: Route | null = null;
  trail: LatLng[] = [];
  endedAt: number | null = null;
  lastDriverActivity: number;

  private constructor(
    readonly code: string,
    readonly createdAt: number,
    public driverId: string,
  ) {
    this.lastDriverActivity = createdAt;
  }

  static create(code: string, driverName: unknown, now: number) {
    const name = cleanName(driverName);
    const trip = new Trip(code, now, '');
    const { member, sessionId } = trip.addMember(name, 'driver');
    trip.driverId = member.id;
    return { trip, memberId: member.id, sessionId };
  }

  get driver(): Member {
    return this.members.get(this.driverId)!;
  }

  private addMember(name: string, role: Role) {
    const sessionId = newSessionId();
    const member: Member = {
      id: newId(),
      sessionHash: hashSession(sessionId),
      name,
      role,
      connected: true,
      lastFix: null,
      pickup: null,
      staleSent: false,
    };
    this.members.set(member.id, member);
    return { member, sessionId };
  }

  join(rawName: unknown, role: unknown) {
    if (this.phase === 'ended') throw new TripError('TRIP_ENDED');
    if (role !== 'passenger' && role !== 'viewer') throw new TripError('INVALID_REQUEST');
    const { member, sessionId } = this.addMember(cleanName(rawName), role);
    return { memberId: member.id, sessionId };
  }

  /** Passageiro de mentira com ponto já confirmado, para testar sem outros aparelhos. */
  addBot(name: string, point: LatLng): Member {
    this.assertActive();
    const { member } = this.addMember(name, 'passenger');
    this.setPickup(member.id, point, 'fixed', true);
    return member;
  }

  memberBySession(sessionId: unknown): Member | null {
    if (typeof sessionId !== 'string' || !sessionId) return null;
    const hash = hashSession(sessionId);
    for (const m of this.members.values()) if (m.sessionHash === hash) return m;
    return null;
  }

  member(id: string): Member {
    const m = this.members.get(id);
    if (!m) throw new TripError('NOT_IN_TRIP');
    return m;
  }

  pendingStops(): Stop[] {
    return this.stops.filter((s) => s.status === 'pending');
  }

  private assertActive() {
    if (this.phase === 'ended') throw new TripError('TRIP_ENDED');
  }

  updatePosition(memberId: string, input: FixInput, now: number): PositionResult {
    const none: PositionResult = { fix: null, arrived: null, stopsChanged: false };
    if (this.phase === 'ended') return none;
    if (!isValidPoint(input)) throw new TripError('INVALID_POINT');
    const m = this.member(memberId);
    if (m.lastFix && now - m.lastFix.at < POS_MIN_INTERVAL_MS) return none;

    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const accuracy = Math.max(0, num(input.accuracy) ?? 9999);
    const fix: Fix = {
      lat: input.lat,
      lng: input.lng,
      accuracy,
      heading: num(input.heading),
      speed: num(input.speed),
      at: now,
    };
    m.lastFix = fix;
    const result: PositionResult = { fix, arrived: null, stopsChanged: false };

    if (m.id === this.driverId) {
      this.lastDriverActivity = now;
      if (this.phase === 'driving' && accuracy <= GOOD_ACCURACY_M) {
        const last = this.trail[this.trail.length - 1];
        if (!last || haversine(last, fix) >= TRAIL_MIN_STEP_M) {
          this.trail.push({ lat: fix.lat, lng: fix.lng });
          if (this.trail.length > TRAIL_MAX_POINTS) this.trail.shift();
        }
        result.arrived = this.checkArrival(fix, now);
      }
      return result;
    }

    // Passageiro no modo "seguir meu GPS": a parada anda com ele, em passos.
    const p = m.pickup;
    if (p?.confirmed && p.mode === 'follow' && accuracy <= 100) {
      const stop = this.stops.find((s) => s.memberId === m.id && s.status === 'pending');
      if (stop && haversine(p.point, fix) >= FOLLOW_STEP_M) {
        p.point = { lat: fix.lat, lng: fix.lng };
        p.address = null;
        stop.point = p.point;
        stop.address = null;
        stop.approached = false;
        stop.access = null;
        result.stopsChanged = true;
      }
    }
    return result;
  }

  /** Chegada automática: só vale para a próxima parada pendente. */
  private checkArrival(fix: Fix, now: number): Stop | null {
    const next = this.pendingStops()[0];
    if (!next) return null;
    const d = Math.min(
      haversine(fix, next.point),
      next.access ? haversine(fix, next.access) : Infinity,
    );
    if (d <= ARRIVE_RADIUS_M) return this.markArrived(next, 'auto', now);
    if (d <= APPROACH_RADIUS_M) {
      next.approached = true;
      return null;
    }
    if (next.approached && d > DEPART_RADIUS_M) return this.markArrived(next, 'auto', now);
    return null;
  }

  private markArrived(stop: Stop, by: 'auto' | 'manual', now: number): Stop {
    stop.status = 'arrived';
    stop.arrivedAt = now;
    stop.arrivedBy = by;
    stop.etaSeconds = null;
    stop.etaMeters = null;
    // Concluídas primeiro, na ordem em que aconteceram.
    const arrived = this.stops
      .filter((s) => s.status === 'arrived')
      .sort((a, b) => a.arrivedAt! - b.arrivedAt!);
    this.stops = [...arrived, ...this.pendingStops()];
    if (this.phase === 'driving' && this.pendingStops().length === 0) this.end(now);
    return stop;
  }

  arrive(stopId: unknown, now: number): Stop {
    if (this.phase !== 'driving') throw new TripError('INVALID_REQUEST');
    const stop = this.stops.find((s) => s.id === stopId && s.status === 'pending');
    if (!stop) throw new TripError('INVALID_REQUEST');
    return this.markArrived(stop, 'manual', now);
  }

  /** Define o ponto de encontro. Devolve true se as paradas mudaram. */
  setPickup(memberId: string, point: unknown, mode: unknown, confirmed: unknown): boolean {
    this.assertActive();
    const m = this.member(memberId);
    if (m.role === 'driver') throw new TripError('INVALID_REQUEST');
    if (!isValidPoint(point)) throw new TripError('INVALID_POINT');
    if (mode !== 'fixed' && mode !== 'follow') throw new TripError('INVALID_REQUEST');
    const p = { lat: point.lat, lng: point.lng };
    const moved = !m.pickup || haversine(m.pickup.point, p) > 3;
    m.role = 'passenger';
    m.pickup = {
      point: p,
      mode: mode as PickupMode,
      address: moved ? null : m.pickup!.address,
      confirmed: confirmed === true,
    };
    if (!m.pickup.confirmed) return false;

    const existing = this.stops.find((s) => s.memberId === m.id);
    if (existing) {
      if (existing.status === 'arrived' || !moved) return false;
      existing.point = p;
      existing.address = null;
      existing.approached = false;
      existing.access = null;
      return true;
    }
    const stop: Stop = {
      id: newId(),
      kind: 'member',
      memberId: m.id,
      point: p,
      label: m.name,
      address: null,
      status: 'pending',
      arrivedAt: null,
      arrivedBy: null,
      etaSeconds: null,
      etaMeters: null,
      approached: false,
      access: null,
    };
    // Entra no fim da fila, antes do destino final.
    const destAt = this.stops.findIndex((s) => s.kind === 'destination');
    if (destAt === -1) this.stops.push(stop);
    else this.stops.splice(destAt, 0, stop);
    return true;
  }

  /** Grava o endereço, se o ponto ainda for o mesmo de quando a busca começou. */
  setAddress(point: LatLng, address: string): boolean {
    let changed = false;
    for (const s of this.stops) {
      if (s.address === null && haversine(s.point, point) < 1) {
        s.address = address;
        changed = true;
      }
    }
    for (const m of this.members.values()) {
      if (m.pickup && m.pickup.address === null && haversine(m.pickup.point, point) < 1) {
        m.pickup.address = address;
        changed = true;
      }
    }
    return changed;
  }

  /** Reordena as paradas pendentes de pessoas. O destino final fica sempre por último. */
  setOrder(stopIds: unknown) {
    this.assertActive();
    const pending = this.pendingStops().filter((s) => s.kind === 'member');
    if (
      !Array.isArray(stopIds) ||
      stopIds.length !== pending.length ||
      new Set(stopIds).size !== stopIds.length ||
      !stopIds.every((id) => pending.some((s) => s.id === id))
    ) {
      throw new TripError('INVALID_REQUEST');
    }
    const byId = new Map(pending.map((s) => [s.id, s]));
    this.stops = [
      ...this.stops.filter((s) => s.status === 'arrived'),
      ...stopIds.map((id) => byId.get(id as string)!),
      ...this.pendingStops().filter((s) => s.kind === 'destination'),
    ];
  }

  setDestination(dest: unknown) {
    this.assertActive();
    this.stops = this.stops.filter((s) => !(s.kind === 'destination' && s.status === 'pending'));
    if (dest === null) return;
    const d = dest as { point?: unknown; label?: unknown };
    if (!d || !isValidPoint(d.point)) throw new TripError('INVALID_POINT');
    const label =
      typeof d.label === 'string' ? d.label.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX) : '';
    this.stops.push({
      id: newId(),
      kind: 'destination',
      memberId: null,
      point: { lat: d.point.lat, lng: d.point.lng },
      label: label || 'Destino final',
      address: null,
      status: 'pending',
      arrivedAt: null,
      arrivedBy: null,
      etaSeconds: null,
      etaMeters: null,
      approached: false,
      access: null,
    });
  }

  start() {
    if (this.phase !== 'lobby') throw new TripError('INVALID_REQUEST');
    if (this.pendingStops().length === 0) throw new TripError('NO_STOPS');
    this.phase = 'driving';
    const fix = this.driver.lastFix;
    this.trail = fix ? [{ lat: fix.lat, lng: fix.lng }] : [];
  }

  removeMember(memberId: unknown) {
    this.assertActive();
    if (typeof memberId !== 'string' || memberId === this.driverId) {
      throw new TripError('INVALID_REQUEST');
    }
    if (!this.members.delete(memberId)) throw new TripError('INVALID_REQUEST');
    this.stops = this.stops.filter((s) => !(s.memberId === memberId && s.status === 'pending'));
  }

  end(now: number) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.endedAt = now;
    // Privacidade: encerrou, some tudo que é posição.
    this.route = null;
    this.trail = [];
    for (const m of this.members.values()) m.lastFix = null;
    for (const s of this.stops) {
      s.etaSeconds = null;
      s.etaMeters = null;
    }
  }

  toSnapshot(): TripSnapshot {
    return {
      code: this.code,
      createdAt: this.createdAt,
      phase: this.phase,
      driverId: this.driverId,
      members: [...this.members.values()].map((m) => ({
        id: m.id,
        sessionHash: m.sessionHash,
        name: m.name,
        role: m.role,
        pickup: m.pickup,
      })),
      stops: this.stops.map((s) => ({
        id: s.id,
        kind: s.kind,
        memberId: s.memberId,
        point: s.point,
        label: s.label,
        address: s.address,
        status: s.status,
        arrivedAt: s.arrivedAt,
        arrivedBy: s.arrivedBy,
      })),
    };
  }

  /** Recria a viagem a partir da cópia do motorista. Lança INVALID_REQUEST se a cópia for inválida. */
  static fromSnapshot(snap: TripSnapshot, now: number): Trip {
    const bad = () => new TripError('INVALID_REQUEST');
    if (!snap || typeof snap !== 'object') throw bad();
    if (typeof snap.code !== 'string' || typeof snap.createdAt !== 'number') throw bad();
    if (snap.phase !== 'lobby' && snap.phase !== 'driving') throw bad();
    if (!Array.isArray(snap.members) || !Array.isArray(snap.stops)) throw bad();
    if (snap.members.length > 500 || snap.stops.length > 500) throw bad();

    const trip = new Trip(snap.code, snap.createdAt, String(snap.driverId));
    trip.phase = snap.phase;
    trip.lastDriverActivity = now;
    for (const m of snap.members) {
      if (typeof m.id !== 'string' || !/^[0-9a-f]{64}$/.test(String(m.sessionHash))) throw bad();
      if (m.role !== 'driver' && m.role !== 'passenger' && m.role !== 'viewer') throw bad();
      const pickup =
        m.pickup && isValidPoint(m.pickup.point)
          ? {
              point: { lat: m.pickup.point.lat, lng: m.pickup.point.lng },
              mode: m.pickup.mode === 'follow' ? ('follow' as const) : ('fixed' as const),
              address: typeof m.pickup.address === 'string' ? m.pickup.address : null,
              confirmed: m.pickup.confirmed === true,
            }
          : null;
      trip.members.set(m.id, {
        id: m.id,
        sessionHash: m.sessionHash,
        name: cleanName(m.name),
        role: m.role,
        connected: false,
        lastFix: null,
        pickup,
        staleSent: false,
      });
    }
    const driver = trip.members.get(trip.driverId);
    if (!driver || driver.role !== 'driver') throw bad();
    for (const s of snap.stops) {
      if (typeof s.id !== 'string' || !isValidPoint(s.point)) throw bad();
      if (s.kind !== 'member' && s.kind !== 'destination') throw bad();
      if (s.kind === 'member' && !trip.members.has(String(s.memberId))) continue;
      trip.stops.push({
        id: s.id,
        kind: s.kind,
        memberId: s.kind === 'member' ? String(s.memberId) : null,
        point: { lat: s.point.lat, lng: s.point.lng },
        label: String(s.label ?? '').slice(0, LABEL_MAX) || 'Parada',
        address: typeof s.address === 'string' ? s.address : null,
        status: s.status === 'arrived' ? 'arrived' : 'pending',
        arrivedAt: typeof s.arrivedAt === 'number' ? s.arrivedAt : null,
        arrivedBy: s.arrivedBy === 'auto' || s.arrivedBy === 'manual' ? s.arrivedBy : null,
        etaSeconds: null,
        etaMeters: null,
        approached: false,
      access: null,
      });
    }
    return trip;
  }
}
