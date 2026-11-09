import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { createNominatim, nullGeocoder } from './routing/nominatim';
import { createOsrm } from './routing/osrm';
import { straightRouter } from './routing/router';

const PORT = Number(process.env.PORT ?? 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = process.env.CLIENT_DIST ?? path.resolve(here, '../../client/dist/client/browser');

// Os serviços públicos pedem que o app se identifique.
const USER_AGENT = process.env.USER_AGENT ?? 'to-chegando/0.1';
const OSRM_URL = process.env.OSRM_URL ?? 'https://router.project-osrm.org';
const NOMINATIM_URL = process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org';
// ROUTING=offline: sem chamadas externas (rotas em linha reta, sem endereços).
const offline = process.env.ROUTING === 'offline';

const { httpServer } = createApp({
  clientDist,
  production: process.env.NODE_ENV === 'production',
  router: offline ? straightRouter : createOsrm(OSRM_URL, USER_AGENT),
  geocoder: offline ? nullGeocoder : createNominatim(NOMINATIM_URL, USER_AGENT),
});

httpServer.listen(PORT, () => {
  console.log(`Tô Chegando no ar em http://localhost:${PORT}`);
});
