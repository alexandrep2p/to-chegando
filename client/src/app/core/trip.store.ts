import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  ARRIVAL_NOTICE_TTL_MS,
  SEND_DRIVING_MS,
  SEND_IDLE_MS,
  STALE_AFTER_MS,
  decodePolyline,
  type ClientToServer,
  type ErrorCode,
  type Fix,
  type FixInput,
  type LatLng,
  type PickupMode,
  type PlaceResult,
  type SessionAck,
  type StopArrivedEvent,
  type StopView,
  type TripView,
} from '@tc/shared';
import { DeviceService } from './device.service';
import { GeoService } from './geo.service';
import { sessions, type Session } from './session';
import { SocketService } from './socket.service';

export type Screen =
  | 'loading'
  | 'reconnecting'
  | 'notfound'
  | 'removed'
  | 'join'
  | 'pin'
  | 'invite'
  | 'stops'
  | 'driving'
  | 'tracking'
  | 'ended';

type Status = 'idle' | 'loading' | 'join' | 'ready' | 'reconnecting' | 'notfound' | 'removed';

const ERRORS: Partial<Record<ErrorCode, string>> = {
  TRIP_NOT_FOUND: 'Essa viagem não existe mais.',
  TRIP_ENDED: 'Essa viagem já foi encerrada.',
  NOT_DRIVER: 'Só o motorista pode fazer isso.',
  INVALID_NAME: 'Digite um nome de até 20 letras.',
  NO_STOPS: 'Ainda não há nenhuma parada.',
  INVALID_REQUEST: 'Não deu certo. Tente de novo.',
};

/** Tentativas de reencontrar a viagem depois que o servidor reiniciou (5 s cada). */
const MAX_REJOIN_TRIES = 24;

@Injectable({ providedIn: 'root' })
export class TripStore {
  private readonly sock = inject(SocketService);
  readonly geo = inject(GeoService);
  readonly device = inject(DeviceService);

  readonly code = signal<string | null>(null);
  readonly status = signal<Status>('idle');
  readonly view = signal<TripView | null>(null);
  /** Última posição de cada membro, atualizada sem recriar a view. */
  readonly positions = signal<Record<string, Fix>>({});
  /** Relógio local, avança a cada segundo. */
  readonly now = signal(Date.now());
  /** Aviso de chegada pendente para quem está esperando. */
  readonly arrival = signal<StopArrivedEvent | null>(null);
  readonly toast = signal<string | null>(null);
  /** Pergunta de confirmação aberta, se houver. */
  readonly question = signal<{ text: string; action: string; answer: (yes: boolean) => void } | null>(null);
  /** Nome do motorista, na tela de entrada pelo link. */
  readonly inviter = signal<string | null>(null);
  readonly driverStep = signal<'invite' | 'stops'>('invite');
  readonly editingStops = signal(false);
  readonly editingPin = signal(false);
  readonly connected = this.sock.connected;

  private session: Session | null = null;
  /** Relógio do servidor menos o relógio local. */
  private offset = 0;
  private lastSentAt = 0;
  private resuming: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private rejoinTries = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly alerted = new Set<string>();

  readonly serverNow = computed(() => this.now() + this.offset);
  readonly role = computed(() => this.view()?.you.role ?? null);
  readonly meId = computed(() => this.view()?.you.memberId ?? null);
  readonly driverFix = computed<Fix | null>(() => {
    const v = this.view();
    return v ? (this.positions()[v.driver.id] ?? v.driver.fix) : null;
  });
  readonly driverStale = computed(() => {
    const fix = this.driverFix();
    return !!fix && this.serverNow() - fix.at > STALE_AFTER_MS;
  });
  readonly pending = computed(() => this.view()?.stops.filter((s) => s.status === 'pending') ?? []);
  readonly nextStop = computed<StopView | null>(() => this.pending()[0] ?? null);
  readonly myStop = computed<StopView | null>(() => {
    const me = this.meId();
    return this.view()?.stops.find((s) => s.memberId === me) ?? null;
  });
  // Strings intermediárias: a linha só é refeita quando a geometria muda de fato,
  // e não a cada estado novo que chega do servidor.
  private readonly routeGeometry = computed(() => this.view()?.route?.geometry ?? '');
  private readonly trailGeometry = computed(() => this.view()?.trail ?? '');
  readonly routeLine = computed<LatLng[]>(() => decodePolyline(this.routeGeometry()));
  private readonly trailPoints = computed<LatLng[]>(() => decodePolyline(this.trailGeometry()));
  readonly trailLine = computed<LatLng[]>(() => {
    const trail = this.trailPoints();
    const fix = this.driverFix();
    // Liga o fim do rastro à posição atual, para a linha não ficar para trás do carro.
    return fix && trail.length ? [...trail, { lat: fix.lat, lng: fix.lng }] : trail;
  });

  readonly screen = computed<Screen>(() => {
    const status = this.status();
    if (status === 'join' || status === 'notfound' || status === 'removed') return status;
    const v = this.view();
    if (!v) return status === 'reconnecting' ? 'reconnecting' : 'loading';
    if (v.phase === 'ended') return 'ended';
    if (v.you.role === 'driver') {
      if (v.phase === 'driving') return this.editingStops() ? 'stops' : 'driving';
      return this.driverStep();
    }
    const me = v.members.find((m) => m.id === v.you.memberId);
    const needsPin = v.you.role === 'passenger' && !me?.pickup?.confirmed;
    return needsPin || this.editingPin() ? 'pin' : 'tracking';
  });

  constructor() {
    setInterval(() => this.now.set(Date.now()), 1000);

    const s = this.sock.socket;
    s.on('trip:state', (v) => this.onState(v));
    s.on('trip:pos', ({ memberId, fix }) =>
      this.positions.update((p) => ({ ...p, [memberId]: fix })),
    );
    s.on('trip:snapshot', (snap) => sessions.saveSnapshot(snap));
    s.on('trip:removed', () => {
      const code = this.code();
      if (code) sessions.clear(code);
      this.session = null;
      this.view.set(null);
      this.status.set('removed');
      this.geo.stop();
    });
    s.on('stop:arrived', (e) => this.onArrived(e));

    // Retomada: qualquer sinal de que o app voltou à frente dispara a reconexão.
    s.on('connect', () => void this.resume());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.resume();
    });
    window.addEventListener('pageshow', () => void this.resume());
    window.addEventListener('online', () => void this.resume());

    effect(() => {
      const fix = this.geo.fix();
      untracked(() => this.onFix(fix));
    });

    // Tela ligada enquanto houver viagem em andamento.
    effect(() => {
      const v = this.view();
      if (v && v.phase !== 'ended') void this.device.keepAwake();
      else this.device.allowSleep();
    });

    // Simulação: o motorista em trajeto percorre a rota calculada.
    const simDriving = computed(() => {
      const v = this.view();
      return v?.you.role === 'driver' && v.phase === 'driving';
    });
    effect(() => {
      const line = simDriving() ? this.routeLine() : null;
      untracked(() => this.geo.simFollow(line));
    });
  }

  // ---- ciclo de vida ----

  /** Abre a viagem do link: retoma a sessão guardada, ou mostra a tela de entrada. */
  async open(rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    if (this.code() === code && (this.view() || this.status() === 'loading')) return;
    this.reset();
    this.code.set(code);
    this.status.set('loading');
    this.session = sessions.get(code);
    if (this.session) {
      await this.resume();
      return;
    }
    const r = await this.sock.call<{ driverName: string }>('trip:peek', { code });
    if (this.code() !== code) return;
    if (r.ok) {
      this.inviter.set(r.driverName);
      this.status.set('join');
    } else {
      this.status.set('notfound');
    }
  }

  reset() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.rejoinTries = 0;
    this.session = null;
    this.code.set(null);
    this.view.set(null);
    this.positions.set({});
    this.status.set('idle');
    this.arrival.set(null);
    this.inviter.set(null);
    this.driverStep.set('invite');
    this.editingStops.set(false);
    this.editingPin.set(false);
    this.lastSentAt = 0;
    this.geo.stop();
  }

  /** Reassocia este aparelho à viagem e volta a enviar a posição. Seguro para chamar a toda hora. */
  resume(): Promise<void> {
    const code = this.code();
    const session = this.session;
    if (!code || !session) return Promise.resolve();
    if (this.resuming) return this.resuming;

    const run = async () => {
      this.sock.ensureConnected();
      if (session.role !== 'viewer') {
        if (this.geo.active) this.geo.restart();
        else this.geo.start();
      }
      if (this.view() && this.view()!.phase !== 'ended') void this.device.keepAwake();

      let r = await this.sock.call<{ memberId: string }>('trip:resume', {
        code,
        sessionId: session.sessionId,
      });
      if (!r.ok && r.error === 'TRIP_NOT_FOUND' && session.role === 'driver') {
        // O servidor reiniciou e perdeu a viagem: o motorista devolve a cópia guardada.
        const snapshot = sessions.snapshot(code);
        if (snapshot) {
          r = await this.sock.call('trip:resume', { code, sessionId: session.sessionId, snapshot });
        }
      }
      if (this.code() !== code) return;

      if (r.ok) {
        this.rejoinTries = 0;
        this.lastSentAt = 0; // envia a posição já na próxima leitura
        const fix = this.geo.fix();
        if (fix) this.onFix(fix);
        return;
      }
      if (r.error === 'NOT_IN_TRIP') {
        sessions.clear(code);
        this.code.set(null);
        void this.open(code);
        return;
      }
      if (r.error === 'TRIP_NOT_FOUND') {
        // Passageiro: o motorista pode ainda não ter voltado para recriar a viagem.
        if (session.role !== 'driver' && this.rejoinTries < MAX_REJOIN_TRIES) {
          this.rejoinTries++;
          this.retryLater(5000);
          if (!this.view()) this.status.set('reconnecting');
          return;
        }
        sessions.clear(code);
        this.session = null;
        this.view.set(null);
        this.status.set('notfound');
        this.geo.stop();
        return;
      }
      // Sem resposta: rede caiu no meio. Tenta de novo em seguida.
      if (!this.view()) this.status.set('reconnecting');
      this.retryLater(3000);
    };

    this.resuming = run().finally(() => (this.resuming = null));
    return this.resuming;
  }

  private retryLater(ms: number) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.resume();
    }, ms);
  }

  private onState(v: TripView) {
    if (v.code !== this.code()) return;
    this.offset = v.serverNow - Date.now();
    // A view traz a posição oficial de cada um; só troca a local se for mais nova.
    this.positions.update((old) => {
      const next = { ...old };
      for (const m of [v.driver, ...v.members]) {
        if (m.fix && (!next[m.id] || next[m.id].at < m.fix.at)) next[m.id] = m.fix;
      }
      return next;
    });
    this.view.set(v);
    this.status.set('ready');
    if (this.session && this.session.role !== v.you.role) {
      this.session = { ...this.session, role: v.you.role };
      sessions.save(v.code, this.session);
    }
    if (v.phase === 'ended') {
      this.geo.stop();
      this.editingStops.set(false);
      this.editingPin.set(false);
    }
    this.checkMissedArrival(v);
  }

  // ---- posição ----

  private onFix(fix: FixInput | null) {
    const v = this.view();
    if (!fix || !v || v.phase === 'ended' || v.you.role === 'viewer') return;
    const me = v.you.memberId;
    this.positions.update((p) => ({ ...p, [me]: { ...fix, at: Date.now() + this.offset } }));
    const every = v.you.role === 'driver' && v.phase === 'driving' ? SEND_DRIVING_MS : SEND_IDLE_MS;
    const t = Date.now();
    if (t - this.lastSentAt < every - 100) return;
    this.lastSentAt = t;
    this.sock.socket.emit('pos:update', fix);
  }

  // ---- ETA ----

  /** Segundos que faltam até a parada, descontando o tempo desde o cálculo da rota. */
  etaOf(stop: StopView | null): number | null {
    const v = this.view();
    if (!v?.route || !stop || stop.etaSeconds === null) return null;
    if (v.phase !== 'driving') return stop.etaSeconds;
    // Sem sinal do motorista, o tempo congela na última posição conhecida.
    const fix = this.driverFix();
    const ref = this.driverStale() && fix ? fix.at : this.serverNow();
    return Math.max(0, stop.etaSeconds - Math.max(0, ref - v.route.computedAt) / 1000);
  }

  /** Hora prevista de chegada (epoch ms no relógio local). */
  arrivalTimeOf(stop: StopView | null): number | null {
    const eta = this.etaOf(stop);
    return eta === null ? null : this.now() + eta * 1000;
  }

  // ---- aviso de chegada ----

  private onArrived(e: StopArrivedEvent) {
    const v = this.view();
    if (!v) return;
    if (e.memberId === v.you.memberId) this.notifyArrival(e);
    else if (v.you.role === 'driver') this.say(`Parada concluída: ${e.label}`);
    else this.say(`${v.driver.name} chegou: ${e.label}`);
  }

  private notifyArrival(e: StopArrivedEvent) {
    const code = this.code();
    if (!code || this.alerted.has(e.stopId) || sessions.arrivalSeen(code, e.stopId)) return;
    this.alerted.add(e.stopId);
    this.arrival.set(e);
    this.device.arrivalAlert();
  }

  /** O app estava em segundo plano quando o motorista chegou: avisa agora. */
  private checkMissedArrival(v: TripView) {
    const mine = v.stops.find((s) => s.memberId === v.you.memberId);
    if (mine?.status !== 'arrived' || !mine.arrivedAt) return;
    if (v.serverNow - mine.arrivedAt > ARRIVAL_NOTICE_TTL_MS) return;
    this.notifyArrival({
      stopId: mine.id,
      memberId: mine.memberId,
      label: mine.label,
      by: mine.arrivedBy ?? 'manual',
      at: mine.arrivedAt,
    });
  }

  dismissArrival() {
    const code = this.code();
    const e = this.arrival();
    if (code && e) sessions.markArrivalSeen(code, e.stopId);
    this.arrival.set(null);
  }

  // ---- ações ----

  /** Pede confirmação numa folha do próprio app (o confirm() do navegador trava a página). */
  ask(text: string, action: string): Promise<boolean> {
    this.question()?.answer(false);
    return new Promise((resolve) =>
      this.question.set({
        text,
        action,
        answer: (yes) => {
          this.question.set(null);
          resolve(yes);
        },
      }),
    );
  }

  say(message: string) {
    this.toast.set(message);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 3500);
  }

  private async act(event: keyof ClientToServer, ...args: unknown[]): Promise<boolean> {
    const r = await this.sock.call(event, ...args);
    if (!r.ok) this.say(ERRORS[r.error] ?? ERRORS.INVALID_REQUEST!);
    return r.ok;
  }

  private adopt(ack: SessionAck, role: Session['role'], name: string) {
    this.code.set(ack.code);
    this.session = { memberId: ack.memberId, sessionId: ack.sessionId, role, name };
    sessions.save(ack.code, this.session);
    this.lastSentAt = 0;
  }

  /** Cria a viagem. Devolve o código, ou null se falhar. */
  async create(name: string, bots = 0): Promise<string | null> {
    this.reset();
    const r = await this.sock.call<SessionAck>('trip:create', { name, bots });
    if (!r.ok) {
      this.say(ERRORS[r.error] ?? ERRORS.INVALID_REQUEST!);
      return null;
    }
    this.adopt(r, 'driver', name);
    this.geo.start();
    return r.code;
  }

  async join(name: string, role: 'passenger' | 'viewer'): Promise<boolean> {
    const code = this.code();
    if (!code) return false;
    const r = await this.sock.call<SessionAck>('trip:join', { code, name, role });
    if (!r.ok) {
      if (r.error === 'TRIP_NOT_FOUND' || r.error === 'TRIP_ENDED') this.status.set('notfound');
      else this.say(ERRORS[r.error] ?? ERRORS.INVALID_REQUEST!);
      return false;
    }
    this.adopt(r, role, name);
    if (role === 'passenger') this.geo.start();
    return true;
  }

  async setPickup(point: LatLng, mode: PickupMode): Promise<boolean> {
    const ok = await this.act('pickup:set', { point, mode, confirmed: true });
    if (ok) {
      this.editingPin.set(false);
      this.geo.start();
    }
    return ok;
  }

  setOrder = (stopIds: string[]) => this.act('stops:set', { stopIds });
  optimize = () => this.act('stops:optimize');
  setDestination = (dest: { point: LatLng; label: string } | null) =>
    this.act('destination:set', dest);
  arrive = (stopId: string) => this.act('stop:arrive', { stopId });
  removeMember = (memberId: string) => this.act('member:remove', { memberId });
  end = () => this.act('trip:end');

  async start(): Promise<boolean> {
    const ok = await this.act('trip:start');
    if (ok) this.editingStops.set(false);
    return ok;
  }

  async search(query: string): Promise<PlaceResult[]> {
    const fix = this.driverFix();
    const near = fix ? { lat: fix.lat, lng: fix.lng } : null;
    const r = await this.sock.call<{ results: PlaceResult[] }>('geo:search', { query, near });
    return r.ok ? r.results : [];
  }

  /** Sai da viagem (passageiro) ou esquece uma viagem encerrada. */
  async leave() {
    const code = this.code();
    const v = this.view();
    if (v && v.phase !== 'ended' && v.you.role !== 'driver') await this.sock.call('trip:leave');
    if (code) sessions.clear(code);
    this.reset();
  }
}
