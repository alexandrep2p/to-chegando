import type { Role, TripSnapshot } from '@tc/shared';

/**
 * Sessão guardada no aparelho. Fica no localStorage (e não no sessionStorage) porque o
 * sistema pode matar a aba em segundo plano, e a viagem precisa sobreviver a isso.
 */
export interface Session {
  memberId: string;
  sessionId: string;
  role: Role;
  name: string;
}

const tripKey = (code: string) => `tc:trip:${code}`;
const snapKey = (code: string) => `tc:snap:${code}`;
const LAST = 'tc:last';
const NAME = 'tc:name';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Armazenamento cheio ou bloqueado: o app segue funcionando, só não retoma sozinho.
  }
}

export const sessions = {
  get: (code: string) => read<Session>(tripKey(code)),
  save(code: string, session: Session) {
    write(tripKey(code), session);
    write(LAST, code);
    write(NAME, session.name);
  },
  /** Apaga tudo que o aparelho guarda sobre a viagem. */
  clear(code: string) {
    write(tripKey(code), null);
    write(snapKey(code), null);
    if (read<string>(LAST) === code) write(LAST, null);
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(`tc:seen:${code}:`)) localStorage.removeItem(key);
      }
    } catch {
      /* ignora */
    }
  },
  lastCode: () => read<string>(LAST),
  lastName: () => read<string>(NAME) ?? '',

  snapshot: (code: string) => read<TripSnapshot>(snapKey(code)),
  saveSnapshot: (snap: TripSnapshot) => write(snapKey(snap.code), snap),

  /** O aviso de chegada desta parada já foi dispensado neste aparelho? */
  arrivalSeen: (code: string, stopId: string) => read<boolean>(`tc:seen:${code}:${stopId}`) === true,
  markArrivalSeen: (code: string, stopId: string) => write(`tc:seen:${code}:${stopId}`, true),
};
