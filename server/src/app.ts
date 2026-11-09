import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { registerHandlers, type Deps, type IO } from './handlers';

export interface AppOptions extends Deps {
  /** Pasta com o build do cliente. Sem ela, o servidor só atende o Socket.IO. */
  clientDist?: string;
  production?: boolean;
}

export function createApp(opts: AppOptions) {
  const app = express();
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const dist = opts.clientDist;
  if (dist && existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // Fallback da SPA: qualquer rota que não seja arquivo devolve o index.html.
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  const httpServer = createServer(app);
  const io: IO = new Server(httpServer, {
    cors: opts.production ? undefined : { origin: true },
  });
  const handlers = registerHandlers(io, opts);

  return {
    httpServer,
    io,
    ...handlers,
    async close() {
      handlers.close();
      await io.close();
    },
  };
}
