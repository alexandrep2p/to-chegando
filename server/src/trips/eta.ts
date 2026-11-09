import {
  ARRIVE_RADIUS_M,
  OFF_ROUTE_M,
  REROUTE_MAX_AGE_MS,
  REROUTE_MIN_INTERVAL_MS,
  decodePolyline,
  distanceToLine,
  haversine,
  type LatLng,
} from '@tc/shared';
import { straightRoute, type RouteResult, type Router } from '../routing/router';
import type { Trip } from './Trip';

interface PlanState {
  lastAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  /** Chegou pedido novo enquanto um cálculo estava em andamento. */
  dirty: boolean;
}

const routeKey = (trip: Trip) =>
  trip
    .pendingStops()
    .map((s) => `${s.id}:${s.point.lat.toFixed(5)},${s.point.lng.toFixed(5)}`)
    .join('|');

/** Decide quando recalcular a rota de cada viagem e distribui os ETAs pelas paradas. */
export class RoutePlanner {
  private readonly states = new Map<string, PlanState>();

  constructor(
    private readonly router: Router,
    private readonly onUpdate: (trip: Trip) => void,
    private readonly now: () => number = Date.now,
  ) {}

  private state(code: string): PlanState {
    let s = this.states.get(code);
    if (!s) {
      s = { lastAt: 0, timer: null, running: false, dirty: false };
      this.states.set(code, s);
    }
    return s;
  }

  forget(code: string) {
    const s = this.states.get(code);
    if (s?.timer) clearTimeout(s.timer);
    this.states.delete(code);
  }

  /** Pede um recálculo. Pedidos próximos são fundidos em um só. */
  request(trip: Trip) {
    const s = this.state(trip.code);
    if (s.running) {
      s.dirty = true;
      return;
    }
    if (s.timer) return;
    const wait = Math.max(0, s.lastAt + REROUTE_MIN_INTERVAL_MS - this.now());
    s.timer = setTimeout(() => {
      s.timer = null;
      void this.compute(trip);
    }, wait);
  }

  /** Chamado a cada posição do motorista: recalcula se saiu da rota ou se ela envelheceu. */
  onDriverMove(trip: Trip) {
    const fix = trip.driver.lastFix;
    if (!fix || trip.phase === 'ended') return;
    const route = trip.route;
    if (!route) {
      if (trip.pendingStops().length > 0) this.request(trip);
      return;
    }
    const age = this.now() - route.computedAt;
    if (age > REROUTE_MAX_AGE_MS || distanceToLine(fix, route.line) > OFF_ROUTE_M) {
      this.request(trip);
    }
  }

  /** Calcula agora. Exposto para os testes; no uso normal, chame request(). */
  async compute(trip: Trip): Promise<void> {
    const s = this.state(trip.code);
    s.running = true;
    s.dirty = false;
    s.lastAt = this.now();
    try {
      await this.computeOnce(trip);
    } finally {
      s.running = false;
      if (s.dirty && this.states.has(trip.code)) this.request(trip);
    }
  }

  private async computeOnce(trip: Trip) {
    const origin = trip.driver.lastFix;
    const pending = trip.pendingStops();
    if (trip.phase === 'ended' || !origin || pending.length === 0) {
      if (trip.route) {
        trip.route = null;
        for (const st of trip.stops) {
          st.etaSeconds = null;
          st.etaMeters = null;
        }
        this.onUpdate(trip);
      }
      return;
    }

    const key = routeKey(trip);
    const from: LatLng = { lat: origin.lat, lng: origin.lng };
    const points = [from, ...pending.map((p) => p.point)];
    let result: RouteResult;
    let approximate = false;
    try {
      result = await this.router.route(points);
      if (result.legs.length !== pending.length) throw new Error('rota com trechos faltando');
    } catch {
      // Roteador fora do ar: espera 30 s antes de tentar de novo nesta viagem.
      this.state(trip.code).lastAt = this.now() + 25_000;
      // Mantém a rota anterior se ainda vale; senão, estima em linha reta.
      if (trip.route && trip.route.key === key && !trip.route.approximate) return;
      result = straightRoute(points);
      approximate = true;
    }

    // A viagem pode ter mudado enquanto o roteador respondia.
    if ((trip.phase as string) === 'ended') return;
    if (routeKey(trip) !== key) {
      this.state(trip.code).dirty = true;
      return;
    }

    trip.route = {
      geometry: result.geometry,
      line: decodePolyline(result.geometry),
      computedAt: this.now(),
      from,
      approximate,
      key,
    };
    let seconds = 0;
    let meters = 0;
    pending.forEach((stop, i) => {
      seconds += result.legs[i].seconds;
      meters += result.legs[i].meters;
      stop.etaSeconds = Math.round(seconds);
      stop.etaMeters = Math.round(meters);
      const road = result.snapped?.[i + 1];
      stop.access = road && haversine(road, stop.point) > ARRIVE_RADIUS_M ? road : null;
    });
    this.onUpdate(trip);
  }
}
