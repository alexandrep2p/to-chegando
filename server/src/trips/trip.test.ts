import { describe, expect, it } from 'vitest';
import { decodePolyline, encodePolyline, distanceToLine, haversine, type LatLng } from '@tc/shared';
import { straightRouter } from '../routing/router';
import { RoutePlanner } from './eta';
import { Trip, TripError } from './Trip';
import { TripStore } from './TripStore';
import { buildView } from './view';

const BASE: LatLng = { lat: -23.55, lng: -46.63 };
/** Ponto a `m` metros ao norte de BASE. */
const north = (m: number): LatLng => ({ lat: BASE.lat + m / 111_195, lng: BASE.lng });
const fix = (p: LatLng, accuracy = 5) => ({ ...p, accuracy, heading: null, speed: null });

function setup() {
  let t = 1_000_000;
  const tick = (ms = 2000) => (t += ms);
  const { trip, memberId: driverId, sessionId: driverSession } = Trip.create('ABC234', 'Alexandre', t);
  const lari = trip.join('Larissa', 'passenger');
  const mae = trip.join('Mãe', 'passenger');
  trip.setPickup(lari.memberId, north(1000), 'fixed', true);
  trip.setPickup(mae.memberId, north(2000), 'fixed', true);
  const drive = (p: LatLng, accuracy = 5) => trip.updatePosition(driverId, fix(p, accuracy), tick());
  return { trip, driverId, driverSession, lari, mae, drive, now: () => t, tick };
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof TripError ? e.code : e;
  }
  return null;
};

describe('geo', () => {
  it('mede distâncias e codifica polylines', () => {
    expect(haversine(BASE, north(1000))).toBeCloseTo(1000, 0);
    const line = [BASE, north(500), north(1000)];
    expect(decodePolyline(encodePolyline(line))).toEqual(
      line.map((p) => ({ lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 })),
    );
    const side = { lat: north(500).lat, lng: BASE.lng + 0.001 };
    expect(distanceToLine(side, line)).toBeCloseTo(haversine(side, north(500)), 0);
  });
});

describe('entrada e paradas', () => {
  it('aceita qualquer número de pessoas', () => {
    const { trip } = setup();
    for (let i = 0; i < 60; i++) trip.join(`Pessoa ${i}`, 'viewer');
    expect(trip.members.size).toBe(63);
  });

  it('valida nomes', () => {
    const { trip } = setup();
    expect(code(() => trip.join('   ', 'passenger'))).toBe('INVALID_NAME');
    expect(code(() => trip.join('x'.repeat(21), 'passenger'))).toBe('INVALID_NAME');
    expect(code(() => trip.join('Zé', 'driver'))).toBe('INVALID_REQUEST');
  });

  it('cria uma parada por ponto confirmado, com o destino sempre por último', () => {
    const { trip, lari, mae } = setup();
    trip.setDestination({ point: north(3000), label: 'Cantina' });
    const ana = trip.join('Ana', 'viewer');
    trip.setPickup(ana.memberId, north(500), 'fixed', true);
    expect(trip.stops.map((s) => s.label)).toEqual(['Larissa', 'Mãe', 'Ana', 'Cantina']);
    expect(trip.member(ana.memberId).role).toBe('passenger');

    const ids = (names: string[]) => names.map((n) => trip.stops.find((s) => s.label === n)!.id);
    trip.setOrder(ids(['Ana', 'Mãe', 'Larissa']));
    expect(trip.stops.map((s) => s.label)).toEqual(['Ana', 'Mãe', 'Larissa', 'Cantina']);
    expect(code(() => trip.setOrder(ids(['Ana', 'Mãe'])))).toBe('INVALID_REQUEST');
    expect(code(() => trip.setOrder(ids(['Ana', 'Mãe', 'Cantina'])))).toBe('INVALID_REQUEST');

    trip.removeMember(mae.memberId);
    expect(trip.stops.map((s) => s.label)).toEqual(['Ana', 'Larissa', 'Cantina']);
    trip.setDestination(null);
    expect(trip.stops.map((s) => s.label)).toEqual(['Ana', 'Larissa']);
    expect(lari.memberId).toBeTruthy();
  });

  it('não começa sem paradas', () => {
    const { trip } = Trip.create('ABC234', 'Alexandre', 0);
    expect(code(() => trip.start())).toBe('NO_STOPS');
  });
});

describe('posição', () => {
  it('descarta posições frequentes demais', () => {
    const { trip, driverId, now } = setup();
    expect(trip.updatePosition(driverId, fix(BASE), now()).fix).not.toBeNull();
    expect(trip.updatePosition(driverId, fix(north(5)), now() + 500).fix).toBeNull();
    expect(trip.updatePosition(driverId, fix(north(5)), now() + 1600).fix).not.toBeNull();
  });

  it('recusa coordenadas inválidas', () => {
    const { trip, driverId, now } = setup();
    expect(code(() => trip.updatePosition(driverId, fix({ lat: 91, lng: 0 }), now()))).toBe(
      'INVALID_POINT',
    );
    expect(code(() => trip.updatePosition(driverId, fix({ lat: NaN, lng: 0 }), now()))).toBe(
      'INVALID_POINT',
    );
  });

  it('guarda o rastro só em trajeto e só com boa precisão', () => {
    const { trip, drive } = setup();
    drive(BASE);
    expect(trip.trail).toHaveLength(0);
    trip.start();
    expect(trip.trail).toHaveLength(1);
    drive(north(5)); // perto demais do último ponto
    drive(north(100), 200); // impreciso
    drive(north(200));
    expect(trip.trail).toHaveLength(2);
  });

  it('no modo seguir, a parada anda com o passageiro em passos de 50 m', () => {
    const { trip, lari, tick } = setup();
    trip.setPickup(lari.memberId, north(1000), 'follow', true);
    const stop = trip.stops[0];
    stop.approached = true;
    expect(trip.updatePosition(lari.memberId, fix(north(1030)), tick()).stopsChanged).toBe(false);
    expect(trip.updatePosition(lari.memberId, fix(north(1060)), tick()).stopsChanged).toBe(true);
    expect(haversine(stop.point, north(1060))).toBeLessThan(1);
    expect(stop.approached).toBe(false);
  });
});

describe('chegada', () => {
  it('conclui a 20 m do ponto', () => {
    const { trip, drive, lari } = setup();
    trip.start();
    expect(drive(north(970)).arrived).toBeNull(); // 30 m: só se aproximou
    const arrived = drive(north(985)).arrived; // 15 m
    expect(arrived?.memberId).toBe(lari.memberId);
    expect(arrived?.arrivedBy).toBe('auto');
    expect(trip.pendingStops()[0].label).toBe('Mãe');
  });

  it('conclui quando se aproxima e depois se afasta mais de 50 m', () => {
    const { trip, drive, lari } = setup();
    trip.start();
    expect(drive(north(940)).arrived).toBeNull(); // 60 m: ainda não se aproximou
    expect(drive(north(1070)).arrived).toBeNull(); // 70 m do outro lado, sem ter se aproximado
    expect(drive(north(1040)).arrived).toBeNull(); // 40 m: aproximou
    expect(drive(north(1045)).arrived).toBeNull(); // 45 m: ainda perto
    expect(drive(north(1060)).arrived?.memberId).toBe(lari.memberId); // 60 m: afastou
  });

  it('ignora posições imprecisas e não conclui antes do trajeto começar', () => {
    const { trip, drive } = setup();
    expect(drive(north(1000)).arrived).toBeNull(); // lobby
    trip.start();
    expect(drive(north(1000), 80).arrived).toBeNull(); // impreciso
    expect(drive(north(1000)).arrived).not.toBeNull();
  });

  it('só a próxima parada conclui sozinha; o botão vale para qualquer uma', () => {
    const { trip, drive } = setup();
    trip.start();
    expect(drive(north(2000)).arrived).toBeNull(); // em cima da Mãe, que é a 2ª
    const mae = trip.stops[1];
    expect(trip.arrive(mae.id, 5).arrivedBy).toBe('manual');
    expect(trip.stops.map((s) => `${s.label}:${s.status}`)).toEqual(['Mãe:arrived', 'Larissa:pending']);
    expect(code(() => trip.arrive(mae.id, 6))).toBe('INVALID_REQUEST');
  });

  it('encerra ao concluir a última parada e apaga as posições', () => {
    const { trip, drive, driverId } = setup();
    trip.start();
    drive(north(1000));
    expect(trip.phase).toBe('driving');
    drive(north(2000));
    expect(trip.phase).toBe('ended');
    expect(trip.trail).toEqual([]);
    expect(trip.member(driverId).lastFix).toBeNull();
    expect(code(() => trip.join('Zé', 'passenger'))).toBe('TRIP_ENDED');
  });

  it('pino longe da rua: chegar ao ponto de acesso pela rua também conclui', () => {
    const { trip, drive, lari } = setup();
    trip.start();
    trip.stops[0].access = north(880); // a rua passa a 120 m do pino
    expect(drive(north(800)).arrived).toBeNull();
    expect(drive(north(870)).arrived?.memberId).toBe(lari.memberId);
  });

  it('mover o pino zera a aproximação', () => {
    const { trip, drive, lari } = setup();
    trip.start();
    drive(north(960));
    expect(trip.stops[0].approached).toBe(true);
    trip.stops[0].access = north(900);
    trip.setPickup(lari.memberId, north(1200), 'fixed', true);
    expect(trip.stops[0].approached).toBe(false);
    expect(trip.stops[0].access).toBeNull();
    expect(drive(north(1020)).arrived).toBeNull();
  });
});

describe('view', () => {
  it('nunca expõe sessão nem campos internos', () => {
    const { trip, driverId, driverSession, lari, mae, drive } = setup();
    trip.start();
    drive(north(960));
    for (const id of [driverId, lari.memberId, mae.memberId]) {
      const json = JSON.stringify(buildView(trip, id, 2_000_000));
      for (const secret of [driverSession, lari.sessionId, mae.sessionId]) {
        expect(json).not.toContain(secret);
      }
      expect(json).not.toContain('sessionHash');
      expect(json).not.toContain('approached');
      expect(json).not.toContain('access');
      expect(json).not.toContain('staleSent');
    }
  });

  it('marca sem sinal depois de 30 s sem posição', () => {
    const { trip, driverId, lari, drive, now } = setup();
    drive(BASE);
    expect(buildView(trip, lari.memberId, now() + 10_000).driver.stale).toBe(false);
    expect(buildView(trip, lari.memberId, now() + 31_000).driver.stale).toBe(true);
    expect(buildView(trip, driverId, now()).you.role).toBe('driver');
  });
});

describe('retomada', () => {
  it('reconhece o membro pelo sessionId', () => {
    const { trip, driverSession, driverId, lari } = setup();
    expect(trip.memberBySession(driverSession)?.id).toBe(driverId);
    expect(trip.memberBySession(lari.sessionId)?.id).toBe(lari.memberId);
    expect(trip.memberBySession('nada')).toBeNull();
    expect(trip.memberBySession('')).toBeNull();
  });

  it('recria a viagem a partir da cópia do motorista', () => {
    const { trip, driverSession, lari, mae, drive } = setup();
    trip.setDestination({ point: north(3000), label: 'Cantina' });
    trip.start();
    drive(north(1000));
    const snap = JSON.parse(JSON.stringify(trip.toSnapshot()));
    expect(JSON.stringify(snap)).not.toContain(driverSession);

    const back = Trip.fromSnapshot(snap, 9_000_000);
    expect(back.phase).toBe('driving');
    expect(back.stops.map((s) => `${s.label}:${s.status}`)).toEqual([
      'Larissa:arrived',
      'Mãe:pending',
      'Cantina:pending',
    ]);
    expect(back.memberBySession(driverSession)?.role).toBe('driver');
    expect(back.memberBySession(lari.sessionId)?.name).toBe('Larissa');
    expect(back.memberBySession(mae.sessionId)?.pickup?.confirmed).toBe(true);
  });

  it('recusa cópias malformadas', () => {
    const { trip } = setup();
    const snap = trip.toSnapshot();
    expect(code(() => Trip.fromSnapshot({ ...snap, driverId: 'outro' }, 0))).toBe('INVALID_REQUEST');
    expect(code(() => Trip.fromSnapshot({ ...snap, phase: 'ended' }, 0))).toBe('INVALID_REQUEST');
    expect(
      code(() =>
        Trip.fromSnapshot({ ...snap, members: [{ ...snap.members[0], sessionHash: 'x' }] }, 0),
      ),
    ).toBe('INVALID_REQUEST');
  });
});

describe('rota e ETA', () => {
  it('distribui o tempo acumulado pelas paradas pendentes', async () => {
    const { trip, drive } = setup();
    drive(BASE);
    let updates = 0;
    const planner = new RoutePlanner(straightRouter, () => updates++, () => 5_000_000);
    await planner.compute(trip);
    const [a, b] = trip.stops;
    expect(updates).toBe(1);
    expect(trip.route?.approximate).toBe(false);
    expect(a.etaMeters).toBeCloseTo(1300, -1);
    expect(b.etaMeters).toBeCloseTo(2600, -1);
    expect(b.etaSeconds).toBeGreaterThan(a.etaSeconds!);
    planner.forget(trip.code);
  });

  it('cai na estimativa em linha reta quando o roteador falha', async () => {
    const { trip, drive } = setup();
    drive(BASE);
    const broken = {
      route: async () => Promise.reject(new Error('fora do ar')),
      optimize: async (p: LatLng[]) => p.map((_, i) => i),
    };
    const planner = new RoutePlanner(broken, () => undefined, () => 5_000_000);
    await planner.compute(trip);
    expect(trip.route?.approximate).toBe(true);
    expect(trip.stops[0].etaSeconds).toBeGreaterThan(0);
    planner.forget(trip.code);
  });

  it('sem posição do motorista não há rota', async () => {
    const { trip } = setup();
    const planner = new RoutePlanner(straightRouter, () => undefined);
    await planner.compute(trip);
    expect(trip.route).toBeNull();
    planner.forget(trip.code);
  });
});

describe('TripStore', () => {
  it('gera códigos e expira viagens', () => {
    const store = new TripStore();
    const { trip } = store.create('Alexandre', 0);
    expect(trip.code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(store.get(trip.code.toLowerCase())).toBe(trip);

    expect(store.sweep(60 * 60 * 1000).ended).toHaveLength(0);
    expect(store.sweep(3 * 60 * 60 * 1000).ended).toEqual([trip]);
    expect(trip.phase).toBe('ended');
    expect(store.sweep(3 * 60 * 60 * 1000 + 11 * 60 * 1000).deleted).toEqual([trip.code]);
    expect(store.get(trip.code)).toBeUndefined();
  });
});
