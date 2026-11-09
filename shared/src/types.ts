export type LatLng = { lat: number; lng: number };

export type Fix = LatLng & {
  /** Precisão em metros. */
  accuracy: number;
  /** Direção em graus, quando o aparelho informa. */
  heading: number | null;
  /** Velocidade em m/s, quando o aparelho informa. */
  speed: number | null;
  /** Epoch ms, no relógio do servidor. */
  at: number;
};

export type FixInput = Omit<Fix, 'at'>;

export type Role = 'driver' | 'passenger' | 'viewer';
export type Phase = 'lobby' | 'driving' | 'ended';
export type PickupMode = 'fixed' | 'follow';

export type Pickup = {
  point: LatLng;
  mode: PickupMode;
  address: string | null;
  confirmed: boolean;
};

export type StopView = {
  id: string;
  kind: 'member' | 'destination';
  memberId: string | null;
  point: LatLng;
  label: string;
  address: string | null;
  status: 'pending' | 'arrived';
  arrivedAt: number | null;
  arrivedBy: 'auto' | 'manual' | null;
  /** Segundos até a parada, contados a partir de route.computedAt. */
  etaSeconds: number | null;
  /** Metros de estrada até a parada, a partir de route.from. */
  etaMeters: number | null;
};

export type MemberView = {
  id: string;
  name: string;
  role: Role;
  connected: boolean;
  stale: boolean;
  fix: Fix | null;
  pickup: Pickup | null;
};

export type RouteView = {
  /** Polyline codificada (precisão 5). */
  geometry: string;
  computedAt: number;
  /** true quando o roteador falhou e a rota é uma estimativa em linha reta. */
  approximate: boolean;
};

export type TripView = {
  code: string;
  phase: Phase;
  you: { memberId: string; role: Role };
  driver: MemberView;
  /** Todos menos o motorista. */
  members: MemberView[];
  /** Em ordem de visita. */
  stops: StopView[];
  route: RouteView | null;
  /** Rastro do motorista, polyline codificada. */
  trail: string;
  serverNow: number;
};

export type ErrorCode =
  | 'TRIP_NOT_FOUND'
  | 'TRIP_ENDED'
  | 'NOT_DRIVER'
  | 'NOT_IN_TRIP'
  | 'INVALID_NAME'
  | 'INVALID_POINT'
  | 'INVALID_REQUEST'
  | 'NO_STOPS'
  | 'ROUTING_UNAVAILABLE';

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode };

export type SessionAck = { code: string; memberId: string; sessionId: string };

export type PlaceResult = { label: string; point: LatLng };

export type StopArrivedEvent = {
  stopId: string;
  memberId: string | null;
  label: string;
  by: 'auto' | 'manual';
  at: number;
};

export type PosEvent = { memberId: string; fix: Fix };

/** Cópia da viagem guardada no celular do motorista, para recriá-la se o servidor reiniciar. */
export type TripSnapshot = {
  code: string;
  createdAt: number;
  phase: Phase;
  driverId: string;
  members: {
    id: string;
    /** SHA-256 do sessionId. O sessionId em si nunca sai do aparelho do dono. */
    sessionHash: string;
    name: string;
    role: Role;
    pickup: Pickup | null;
  }[];
  stops: Pick<
    StopView,
    'id' | 'kind' | 'memberId' | 'point' | 'label' | 'address' | 'status' | 'arrivedAt' | 'arrivedBy'
  >[];
};

export interface ClientToServer {
  'trip:create': (p: { name: string; bots?: number }, ack: (r: Ack<SessionAck>) => void) => void;
  'trip:join': (
    p: { code: string; name: string; role: 'passenger' | 'viewer' },
    ack: (r: Ack<SessionAck>) => void,
  ) => void;
  'trip:resume': (
    p: { code: string; sessionId: string; snapshot?: TripSnapshot },
    ack: (r: Ack<{ memberId: string }>) => void,
  ) => void;
  'trip:peek': (p: { code: string }, ack: (r: Ack<{ driverName: string }>) => void) => void;
  'pos:update': (p: FixInput, ack?: (r: Ack) => void) => void;
  'pickup:set': (
    p: { point: LatLng; mode: PickupMode; confirmed: boolean },
    ack: (r: Ack) => void,
  ) => void;
  'stops:set': (p: { stopIds: string[] }, ack: (r: Ack) => void) => void;
  'stops:optimize': (ack: (r: Ack) => void) => void;
  'destination:set': (p: { point: LatLng; label: string } | null, ack: (r: Ack) => void) => void;
  'geo:search': (
    p: { query: string; near: LatLng | null },
    ack: (r: Ack<{ results: PlaceResult[] }>) => void,
  ) => void;
  'trip:start': (ack: (r: Ack) => void) => void;
  'stop:arrive': (p: { stopId: string }, ack: (r: Ack) => void) => void;
  'member:remove': (p: { memberId: string }, ack: (r: Ack) => void) => void;
  'trip:leave': (ack: (r: Ack) => void) => void;
  'trip:end': (ack: (r: Ack) => void) => void;
}

export interface ServerToClient {
  'trip:state': (view: TripView) => void;
  'trip:pos': (e: PosEvent) => void;
  'trip:removed': () => void;
  'trip:snapshot': (s: TripSnapshot) => void;
  'stop:arrived': (e: StopArrivedEvent) => void;
}
