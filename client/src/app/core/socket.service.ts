import { Injectable, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServer, ServerToClient } from '@tc/shared';

const ACK_TIMEOUT_MS = 10_000;

@Injectable({ providedIn: 'root' })
export class SocketService {
  readonly socket: Socket<ServerToClient, ClientToServer> = io({
    transports: ['websocket', 'polling'],
    reconnectionDelayMax: 3000,
  });
  readonly connected = signal(false);

  constructor() {
    this.socket.on('connect', () => this.connected.set(true));
    this.socket.on('disconnect', () => this.connected.set(false));
  }

  /** Reconecta já, sem esperar o próximo ciclo de tentativa. */
  ensureConnected() {
    if (!this.socket.connected) this.socket.connect();
  }

  /** Emite e espera a resposta. Sem resposta a tempo, devolve { ok: false }. */
  call<T = object>(event: keyof ClientToServer, ...args: unknown[]): Promise<Ack<T>> {
    return new Promise((resolve) => {
      (this.socket.timeout(ACK_TIMEOUT_MS) as any).emit(
        event,
        ...args,
        (err: unknown, res: Ack<T>) =>
          resolve(err || !res ? { ok: false, error: 'INVALID_REQUEST' } : res),
      );
    });
  }
}
