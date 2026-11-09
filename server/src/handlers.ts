import type { Server, Socket } from 'socket.io';
import {
  SEARCH_MAX,
  TRIP_MAX_TTL_MS,
  isValidPoint,
  type Ack,
  type ClientToServer,
  type ServerToClient,
} from '@tc/shared';
import type { Geocoder } from './routing/nominatim';
import type { Router } from './routing/router';
import { RoutePlanner } from './trips/eta';
import { Trip, TripError, hashSession, type Member, type Stop } from './trips/Trip';
import { TripStore, normalizeCode } from './trips/TripStore';
import { buildView, isStale } from './trips/view';

type SocketData = { code?: string; memberId?: string };
export type IO = Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>;
type Sock = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

export interface Deps {
  router: Router;
  geocoder: Geocoder;
  now?: () => number;
}

const STALE_CHECK_MS = 10_000;
const SWEEP_MS = 60_000;

export function registerHandlers(io: IO, deps: Deps) {
  const now = deps.now ?? Date.now;
  const store = new TripStore();
  const planner = new RoutePlanner(deps.router, (trip) => emitState(trip), now);

  const socketsOf = (code: string): Sock[] =>
    [...io.sockets.sockets.values()].filter((s) => s.data.code === code);

  function emitState(trip: Trip) {
    const t = now();
    for (const m of trip.members.values()) m.staleSent = isStale(m, t);
    for (const s of socketsOf(trip.code)) {
      const memberId = s.data.memberId;
      if (!memberId || !trip.members.has(memberId)) continue;
      s.emit('trip:state', buildView(trip, memberId, t));
      if (memberId === trip.driverId && trip.phase !== 'ended') {
        s.emit('trip:snapshot', trip.toSnapshot());
      }
    }
    if (trip.phase === 'ended') planner.forget(trip.code);
  }

  function bind(socket: Sock, trip: Trip, member: Member) {
    if (socket.data.code && socket.data.code !== trip.code) void socket.leave(socket.data.code);
    socket.data.code = trip.code;
    socket.data.memberId = member.id;
    void socket.join(trip.code);
    member.connected = true;
  }

  function unbind(socket: Sock) {
    if (socket.data.code) void socket.leave(socket.data.code);
    socket.data.code = undefined;
    socket.data.memberId = undefined;
  }

  /** A viagem e o membro deste socket, ou erro. */
  function ctx(socket: Sock): { trip: Trip; member: Member } {
    const trip = socket.data.code ? store.get(socket.data.code) : undefined;
    const member = trip && socket.data.memberId ? trip.members.get(socket.data.memberId) : undefined;
    if (!trip || !member) throw new TripError('NOT_IN_TRIP');
    return { trip, member };
  }

  function driverCtx(socket: Sock) {
    const c = ctx(socket);
    if (c.member.id !== c.trip.driverId) throw new TripError('NOT_DRIVER');
    return c;
  }

  /** Roda o handler e responde o ack, traduzindo TripError em { ok: false }. */
  async function reply<T extends object>(
    ack: ((r: Ack<T>) => void) | undefined,
    fn: () => T | Promise<T>,
  ) {
    try {
      const data = await fn();
      if (typeof ack === 'function') ack({ ok: true, ...data } as Ack<T>);
    } catch (e) {
      if (!(e instanceof TripError)) console.error(e);
      if (typeof ack === 'function') {
        ack({ ok: false, error: e instanceof TripError ? e.code : 'INVALID_REQUEST' });
      }
    }
  }

  function announceArrival(trip: Trip, stop: Stop) {
    io.to(trip.code).emit('stop:arrived', {
      stopId: stop.id,
      memberId: stop.memberId,
      label: stop.label,
      by: stop.arrivedBy ?? 'manual',
      at: stop.arrivedAt ?? now(),
    });
  }

  /** Busca o endereço do ponto em segundo plano e avisa quando chegar. */
  function fillAddress(trip: Trip, point: { lat: number; lng: number }) {
    void deps.geocoder.reverse(point).then((address) => {
      if (address && trip.phase !== 'ended' && trip.setAddress(point, address)) emitState(trip);
    });
  }

  io.on('connection', (socket) => {
    socket.on('trip:create', (p, ack) =>
      reply(ack, () => {
        const { trip, memberId, sessionId } = store.create(p?.name, now());
        bind(socket, trip, trip.driver);
        emitState(trip);
        return { code: trip.code, memberId, sessionId };
      }),
    );

    socket.on('trip:peek', (p, ack) =>
      reply(ack, () => {
        const trip = store.get(p?.code);
        if (!trip) throw new TripError('TRIP_NOT_FOUND');
        if (trip.phase === 'ended') throw new TripError('TRIP_ENDED');
        return { driverName: trip.driver.name };
      }),
    );

    socket.on('trip:join', (p, ack) =>
      reply(ack, () => {
        const trip = store.get(p?.code);
        if (!trip) throw new TripError('TRIP_NOT_FOUND');
        const { memberId, sessionId } = trip.join(p?.name, p?.role);
        bind(socket, trip, trip.member(memberId));
        emitState(trip);
        return { code: trip.code, memberId, sessionId };
      }),
    );

    socket.on('trip:resume', (p, ack) =>
      reply(ack, () => {
        const code = normalizeCode(p?.code);
        let trip = store.get(code);
        let restored = false;
        if (!trip && p?.snapshot) {
          // O servidor reiniciou: o motorista devolve a cópia que guardou.
          const snap = p.snapshot;
          const driver = snap.members?.find?.((m) => m.id === snap.driverId);
          const mine = typeof p.sessionId === 'string' && hashSession(p.sessionId);
          if (
            normalizeCode(snap.code) !== code ||
            !driver ||
            driver.sessionHash !== mine ||
            now() - snap.createdAt > TRIP_MAX_TTL_MS
          ) {
            throw new TripError('TRIP_NOT_FOUND');
          }
          trip = Trip.fromSnapshot({ ...snap, code }, now());
          store.add(trip);
          restored = true;
        }
        if (!trip) throw new TripError('TRIP_NOT_FOUND');
        const member = trip.memberBySession(p?.sessionId);
        if (!member) throw new TripError('NOT_IN_TRIP');
        bind(socket, trip, member);
        emitState(trip);
        if (restored) planner.request(trip);
        return { memberId: member.id };
      }),
    );

    socket.on('pos:update', (p, ack) =>
      reply(ack, () => {
        const { trip, member } = ctx(socket);
        const wasStale = member.staleSent;
        const res = trip.updatePosition(member.id, p, now());
        if (!res.fix) return {};
        io.to(trip.code).emit('trip:pos', { memberId: member.id, fix: res.fix });
        if (res.arrived) announceArrival(trip, res.arrived);
        if (res.arrived || res.stopsChanged) {
          if (trip.phase !== 'ended') planner.request(trip);
          emitState(trip);
        } else if (wasStale) {
          emitState(trip);
        }
        if (member.id === trip.driverId) planner.onDriverMove(trip);
        return {};
      }),
    );

    socket.on('pickup:set', (p, ack) =>
      reply(ack, () => {
        const { trip, member } = ctx(socket);
        const changed = trip.setPickup(member.id, p?.point, p?.mode, p?.confirmed);
        if (changed) planner.request(trip);
        emitState(trip);
        if (member.pickup && !member.pickup.address) fillAddress(trip, member.pickup.point);
        return {};
      }),
    );

    socket.on('stops:set', (p, ack) =>
      reply(ack, () => {
        const { trip } = driverCtx(socket);
        trip.setOrder(p?.stopIds);
        planner.request(trip);
        emitState(trip);
        return {};
      }),
    );

    socket.on('stops:optimize', (ack) =>
      reply(ack, async () => {
        const { trip } = driverCtx(socket);
        const from = trip.driver.lastFix;
        const pending = trip.pendingStops();
        const people = pending.filter((s) => s.kind === 'member');
        const dest = pending.find((s) => s.kind === 'destination');
        if (!from || people.length < 2) return {};
        const points = [from, ...people.map((s) => s.point), ...(dest ? [dest.point] : [])];
        const order = await deps.router.optimize(points, !!dest);
        const ids = order
          .filter((i) => i >= 1 && i <= people.length)
          .map((i) => people[i - 1].id);
        // As paradas podem ter mudado enquanto o roteador respondia; setOrder valida.
        trip.setOrder(ids);
        planner.request(trip);
        emitState(trip);
        return {};
      }),
    );

    socket.on('destination:set', (p, ack) =>
      reply(ack, () => {
        const { trip } = driverCtx(socket);
        trip.setDestination(p);
        planner.request(trip);
        emitState(trip);
        if (p) fillAddress(trip, p.point);
        return {};
      }),
    );

    socket.on('geo:search', (p, ack) =>
      reply(ack, async () => {
        driverCtx(socket);
        const query = typeof p?.query === 'string' ? p.query.slice(0, SEARCH_MAX) : '';
        const near = isValidPoint(p?.near) ? p.near : null;
        return { results: await deps.geocoder.search(query, near) };
      }),
    );

    socket.on('trip:start', (ack) =>
      reply(ack, () => {
        const { trip } = driverCtx(socket);
        trip.start();
        planner.request(trip);
        emitState(trip);
        return {};
      }),
    );

    socket.on('stop:arrive', (p, ack) =>
      reply(ack, () => {
        const { trip } = driverCtx(socket);
        const stop = trip.arrive(p?.stopId, now());
        announceArrival(trip, stop);
        if (trip.phase !== 'ended') planner.request(trip);
        emitState(trip);
        return {};
      }),
    );

    socket.on('member:remove', (p, ack) =>
      reply(ack, () => {
        const { trip } = driverCtx(socket);
        trip.removeMember(p?.memberId);
        for (const s of socketsOf(trip.code)) {
          if (s.data.memberId === p.memberId) {
            s.emit('trip:removed');
            unbind(s);
          }
        }
        planner.request(trip);
        emitState(trip);
        return {};
      }),
    );

    socket.on('trip:leave', (ack) =>
      reply(ack, () => {
        const { trip, member } = ctx(socket);
        if (member.id === trip.driverId) throw new TripError('INVALID_REQUEST');
        if (trip.phase !== 'ended') trip.removeMember(member.id);
        for (const s of socketsOf(trip.code)) if (s.data.memberId === member.id) unbind(s);
        if (trip.phase !== 'ended') planner.request(trip);
        emitState(trip);
        return {};
      }),
    );

    socket.on('trip:end', (ack) =>
      reply(ack, () => {
        const { trip } = driverCtx(socket);
        trip.end(now());
        emitState(trip);
        return {};
      }),
    );

    socket.on('disconnect', () => {
      const { code, memberId } = socket.data;
      const trip = code ? store.get(code) : undefined;
      const member = trip && memberId ? trip.members.get(memberId) : undefined;
      if (!trip || !member) return;
      // Outra aba do mesmo membro pode continuar conectada.
      const others = socketsOf(trip.code).some((s) => s.id !== socket.id && s.data.memberId === memberId);
      if (others) return;
      member.connected = false;
      emitState(trip);
    });
  });

  // "Sem sinal" é passagem de tempo, não evento: reavalia periodicamente.
  const staleTimer = setInterval(() => {
    const t = now();
    for (const trip of store.all()) {
      if (trip.phase === 'ended') continue;
      for (const m of trip.members.values()) {
        if (isStale(m, t) !== m.staleSent) {
          emitState(trip);
          break;
        }
      }
    }
  }, STALE_CHECK_MS);

  const sweepTimer = setInterval(() => {
    const { ended, deleted } = store.sweep(now());
    for (const trip of ended) emitState(trip);
    for (const code of deleted) {
      planner.forget(code);
      for (const s of socketsOf(code)) unbind(s);
    }
  }, SWEEP_MS);

  return {
    store,
    planner,
    close() {
      clearInterval(staleTimer);
      clearInterval(sweepTimer);
    },
  };
}
