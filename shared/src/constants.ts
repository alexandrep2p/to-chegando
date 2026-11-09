export const NAME_MAX = 20;
export const CODE_LENGTH = 6;
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const SEARCH_MAX = 100;
/** Máximo de passageiros de mentira no modo de teste (?bots=N). */
export const MAX_BOTS = 8;
export const LABEL_MAX = 80;

/** O servidor descarta posições do mesmo membro mais frequentes que isto. */
export const POS_MIN_INTERVAL_MS = 1500;
/** Sem posição do membro há mais que isto: "sem sinal". */
export const STALE_AFTER_MS = 30_000;

/** A esta distância da parada, o motorista chegou. */
export const ARRIVE_RADIUS_M = 20;
/** A esta distância, o motorista "se aproximou" da parada. */
export const APPROACH_RADIUS_M = 50;
/** Depois de se aproximar, afastar-se mais que isto também conta como chegada. */
export const DEPART_RADIUS_M = 50;
/** Posições menos precisas que isto não contam para chegada nem rastro. */
export const GOOD_ACCURACY_M = 50;

export const OFF_ROUTE_M = 60;
export const REROUTE_MIN_INTERVAL_MS = 5000;
export const REROUTE_MAX_AGE_MS = 60_000;
/** No modo "seguir meu GPS", a parada só anda quando o passageiro andou isto. */
export const FOLLOW_STEP_M = 50;
export const FALLBACK_SPEED_MPS = 25 / 3.6;

export const TRAIL_MIN_STEP_M = 15;
export const TRAIL_MAX_POINTS = 2000;

export const TRIP_IDLE_TTL_MS = 2 * 60 * 60 * 1000;
export const TRIP_MAX_TTL_MS = 12 * 60 * 60 * 1000;
export const ENDED_TTL_MS = 10 * 60 * 1000;

/** Intervalos de envio de posição pelo cliente. */
export const SEND_DRIVING_MS = 2000;
export const SEND_IDLE_MS = 10_000;
/** O aviso de chegada ainda é mostrado se a pessoa voltar ao app dentro deste prazo. */
export const ARRIVAL_NOTICE_TTL_MS = 10 * 60 * 1000;
