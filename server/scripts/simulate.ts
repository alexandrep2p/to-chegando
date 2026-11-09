/**
 * Viagem completa com 3 clientes Socket.IO reais, sem rede externa:
 * entrada, paradas, trajeto, chegadas, queda e retomada, reinício do servidor.
 */
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  Ack,
  ClientToServer,
  LatLng,
  ServerToClient,
  SessionAck,
  StopArrivedEvent,
  TripSnapshot,
  TripView,
} from '@tc/shared';
import { createApp } from '../src/app';
import { nullGeocoder } from '../src/routing/nominatim';
import { straightRouter } from '../src/routing/router';

type Client = Socket<ServerToClient, ClientToServer> & {
  view?: TripView;
  snapshot?: TripSnapshot;
  arrivals: StopArrivedEvent[];
  received: string[];
};

let clock = Date.now();
const BASE: LatLng = { lat: -23.55, lng: -46.63 };
const north = (m: number): LatLng => ({ lat: BASE.lat + m / 111_195, lng: BASE.lng });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function check(cond: unknown, what: string) {
  if (!cond) {
    console.error(`  FALHOU: ${what}`);
    process.exit(1);
  }
  console.log(`  ok  ${what}`);
}

function start(port = 0) {
  const app = createApp({ router: straightRouter, geocoder: nullGeocoder, now: () => clock });
  return new Promise<{ app: ReturnType<typeof createApp>; port: number }>((resolve) => {
    app.httpServer.listen(port, () =>
      resolve({ app, port: (app.httpServer.address() as AddressInfo).port }),
    );
  });
}

function client(port: number): Promise<Client> {
  const s = connect(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
  }) as Client;
  s.arrivals = [];
  s.received = [];
  s.onAny((_event, payload) => s.received.push(JSON.stringify(payload)));
  s.on('trip:state', (v) => (s.view = v));
  s.on('trip:snapshot', (snap) => (s.snapshot = snap));
  s.on('stop:arrived', (e) => s.arrivals.push(e));
  return new Promise((resolve) => s.on('connect', () => resolve(s)));
}

/** Emite e espera o ack. */
function call<T = object>(s: Client, event: string, ...args: unknown[]): Promise<Ack<T>> {
  return new Promise((resolve) => (s as any).emit(event, ...args, resolve));
}

async function drive(s: Client, p: LatLng) {
  clock += 2000;
  await call(s, 'pos:update', { ...p, accuracy: 5, heading: 0, speed: 10 });
  await sleep(30);
}

async function main() {
  let { app, port } = await start();
  console.log(`servidor de teste na porta ${port}\n`);

  console.log('Lobby');
  const driver = await client(port);
  const created = (await call<SessionAck>(driver, 'trip:create', { name: 'Alexandre' })) as {
    ok: true;
  } & SessionAck;
  check(created.ok && created.code.length === 6, 'motorista cria a viagem');
  const code = created.code;

  const lari = await client(port);
  const mae = await client(port);
  const peek = await call<{ driverName: string }>(lari, 'trip:peek', { code: code.toLowerCase() });
  check(peek.ok && peek.driverName === 'Alexandre', 'link mostra quem convida');
  const jl = (await call<SessionAck>(lari, 'trip:join', { code, name: 'Larissa', role: 'passenger' })) as { ok: true } & SessionAck;
  const jm = (await call<SessionAck>(mae, 'trip:join', { code, name: 'Mãe', role: 'passenger' })) as { ok: true } & SessionAck;
  check(jl.ok && jm.ok, 'duas pessoas entram pelo código');

  await drive(driver, BASE);
  await call(mae, 'pickup:set', { point: north(2000), mode: 'fixed', confirmed: true });
  await call(lari, 'pickup:set', { point: north(1000), mode: 'fixed', confirmed: true });
  await sleep(50);
  check(driver.view!.stops.map((s) => s.label).join() === 'Mãe,Larissa', 'paradas na ordem de chegada');

  const notDriver = await call(lari, 'trip:start');
  check(!notDriver.ok && notDriver.error === 'NOT_DRIVER', 'passageiro não comanda a viagem');

  await call(driver, 'destination:set', { point: north(3000), label: 'Cantina do Bairro' });
  const opt = await call(driver, 'stops:optimize');
  await sleep(50);
  check(
    opt.ok && driver.view!.stops.map((s) => s.label).join() === 'Larissa,Mãe,Cantina do Bairro',
    'sugerir melhor ordem põe a mais próxima primeiro e mantém o destino por último',
  );

  await sleep(5300); // intervalo mínimo entre cálculos de rota
  const etas = lari.view!.stops.map((s) => s.etaSeconds);
  check(etas.every((e) => typeof e === 'number') && etas[0]! < etas[1]! && etas[1]! < etas[2]!, 'cada parada tem seu ETA, crescente');
  check(!!lari.view!.route?.geometry, 'rota chega para os passageiros');

  console.log('\nTrajeto');
  check((await call(driver, 'trip:start')).ok, 'motorista começa o trajeto');
  await drive(driver, north(400));
  check(mae.view!.phase === 'driving', 'todos passam para a fase de trajeto');

  await drive(driver, north(960));
  check(lari.arrivals.length === 0, 'a 40 m ainda não chegou');
  await drive(driver, north(990));
  check(lari.arrivals.length === 1 && lari.arrivals[0].memberId === jl.memberId && lari.arrivals[0].by === 'auto', 'a 10 m: Larissa é avisada da chegada');
  check(mae.arrivals.length === 1 && mae.view!.stops[0].status === 'arrived', 'os outros veem a fila andar');

  console.log('\nQueda e retomada');
  driver.disconnect();
  await sleep(100);
  check(mae.view!.driver.connected === false, 'motorista desconectado aparece para os outros');
  clock += 40_000;
  await sleep(10_500); // o servidor reavalia "sem sinal" a cada 10 s
  check(mae.view!.driver.stale === true, 'depois de 30 s, sem sinal');

  const driver2 = await client(port);
  const resumed = await call(driver2, 'trip:resume', { code, sessionId: created.sessionId });
  check(resumed.ok && driver2.view?.you.role === 'driver', 'motorista retoma a sessão em outra conexão');
  await drive(driver2, north(1100));
  check(mae.view!.driver.stale === false && mae.view!.driver.connected, 'e o sinal volta para todos');
  check(!!driver2.snapshot, 'motorista recebe a cópia da viagem');
  const snapshot = driver2.snapshot!;

  console.log('\nReinício do servidor');
  for (const s of [driver2, lari, mae]) s.disconnect();
  await app.close();
  ({ app, port } = await start(port));

  const mae2 = await client(port);
  const early = await call(mae2, 'trip:resume', { code, sessionId: jm.sessionId });
  check(!early.ok && early.error === 'TRIP_NOT_FOUND', 'antes do motorista voltar, a viagem não existe');

  const intruder = await client(port);
  const forged = await call(intruder, 'trip:resume', { code, sessionId: 'chute', snapshot });
  check(!forged.ok, 'cópia sem a sessão do motorista é recusada');

  const driver3 = await client(port);
  const restored = await call(driver3, 'trip:resume', { code, sessionId: created.sessionId, snapshot });
  check(restored.ok && driver3.view?.phase === 'driving', 'motorista recria a viagem com a cópia');
  const back = await call(mae2, 'trip:resume', { code, sessionId: jm.sessionId });
  check(back.ok && mae2.view?.stops.map((s) => `${s.label}:${s.status}`).join() === 'Larissa:arrived,Mãe:pending,Cantina do Bairro:pending', 'passageira volta para a mesma viagem, com as paradas intactas');

  console.log('\nFim');
  await drive(driver3, north(1500));
  const manual = await call(driver3, 'stop:arrive', { stopId: mae2.view!.stops[1].id });
  await sleep(50);
  check(manual.ok && mae2.arrivals.at(-1)?.by === 'manual' && mae2.arrivals.at(-1)?.memberId === jm.memberId, 'botão "Cheguei" avisa a Mãe');
  await drive(driver3, north(3000));
  check(mae2.view!.phase === 'ended' && mae2.view!.driver.fix === null && mae2.view!.trail === '', 'última parada encerra a viagem e apaga as posições');
  const late = await call(intruder, 'trip:join', { code, name: 'Zé', role: 'viewer' });
  check(!late.ok && late.error === 'TRIP_ENDED', 'código não aceita mais ninguém');

  console.log('\nPrivacidade');
  const secrets = [created.sessionId, jl.sessionId, jm.sessionId];
  const all = [driver, driver2, driver3, lari, mae, mae2, intruder].flatMap((s) => s.received).join('\n');
  check(secrets.every((s) => !all.includes(s)), 'nenhum sessionId aparece em mensagem do servidor');

  for (const s of [driver3, mae2, intruder]) s.disconnect();
  await app.close();
  console.log('\nSimulação concluída sem falhas.');
  process.exit(0);
}

void main();
