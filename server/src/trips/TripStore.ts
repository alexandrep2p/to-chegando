import { randomInt } from 'node:crypto';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  ENDED_TTL_MS,
  TRIP_IDLE_TTL_MS,
  TRIP_MAX_TTL_MS,
} from '@tc/shared';
import { Trip } from './Trip';

export function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase().slice(0, 12) : '';
}

export class TripStore {
  private readonly trips = new Map<string, Trip>();

  get(code: unknown): Trip | undefined {
    return this.trips.get(normalizeCode(code));
  }

  all(): Trip[] {
    return [...this.trips.values()];
  }

  create(driverName: unknown, now: number) {
    let code: string;
    do {
      code = Array.from(
        { length: CODE_LENGTH },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
    } while (this.trips.has(code));
    const created = Trip.create(code, driverName, now);
    this.trips.set(code, created.trip);
    return created;
  }

  add(trip: Trip) {
    this.trips.set(trip.code, trip);
  }

  /** Encerra viagens esquecidas e apaga as encerradas há tempo. */
  sweep(now: number): { ended: Trip[]; deleted: string[] } {
    const ended: Trip[] = [];
    const deleted: string[] = [];
    for (const trip of this.trips.values()) {
      if (trip.phase === 'ended') {
        if (now - (trip.endedAt ?? 0) > ENDED_TTL_MS) {
          this.trips.delete(trip.code);
          deleted.push(trip.code);
        }
      } else if (
        now - trip.lastDriverActivity > TRIP_IDLE_TTL_MS ||
        now - trip.createdAt > TRIP_MAX_TTL_MS
      ) {
        trip.end(now);
        ended.push(trip);
      }
    }
    return { ended, deleted };
  }
}
