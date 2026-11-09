// O MapLibre desenha o mapa num worker que o build do Angular não empacota.
// Este script copia o arquivo para public/, de onde ele é servido como asset.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const from = path.join(
  path.dirname(require.resolve('maplibre-gl/package.json')),
  'dist',
  'maplibre-gl-worker.mjs',
);
const toDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/maplibre');
mkdirSync(toDir, { recursive: true });
copyFileSync(from, path.join(toDir, 'maplibre-gl-worker.mjs'));
